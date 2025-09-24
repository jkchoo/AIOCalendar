import os
import json
import subprocess
from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO
import sys
import logging

logging.basicConfig(
    stream=sys.stdout,
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s"
);

app = Flask(__name__, static_folder="public")
app.logger.setLevel(logging.DEBUG)
socketio = SocketIO(app)

# Paths
root_path = os.path.dirname(os.path.abspath(__file__));
config_path = os.path.join(root_path, "motion_config.json");
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

with open(os.path.join(root_path, "home_file.conf"), "r") as f:
    home_path = f.readline().strip()

kiosk_path = os.path.join(home_path, "Kiosk.desktop")
kiosk_config = "Exec=env MOZ_USE_XINPUT2=1 firefox --kiosk"


# ---------- Helpers ----------
def get_brightness_path():
    base_path = "/sys/class/backlight"
    try:
        entries = os.listdir(base_path)
        if not entries:
            return None
        return os.path.join(base_path, entries[0], "brightness")
    except Exception as e:
        print(f"Unable to locate brightness control: {e}", flush=True)
        return None

# This function will restart the motion task
def restart_motion():

    stop_motion();
    try:
        start_motion();
    except e:
        return "Error " + e, 500;

    return "Success", 200;

# Start the motion detection program
def start_motion():
    run_com = root_path + "/venv/bin/python3 " + root_path + "/motion.py &";
    print(f"Starting with command \\n{run_com}\\n");
    try:
        code, _, err = run_command(run_com);
        if code != 0:
            print(f"Failed to start motion.py: {err}", flush=True)
            return "Failed to start motion.py", 500;
    except Exception as e:
        print(f"Failed to start motion with exception {e}", flush=True);
        return "Failed to start motion.py", 500;

    return "motion.py started", 200;

# Stop the motion detection program
def stop_motion():
    code, _, err = run_command("pkill -f motion.py");
    if code != 0:
        print(f"Failed to stop motion.py: {err}", flush=True);
        return "Failed to stop motion.py", 500;

    return "Success", 200;


def get_max_brightness(path_to_device):
    try:
        max_path = path_to_device.replace("/brightness", "/max_brightness")
        with open(max_path, "r") as f:
            return int(f.read().strip())
    except Exception:
        print("Could not read max_brightness", flush=True)
        return None


def run_command(cmd, cwd=None):
    try:
        result = subprocess.run(
            cmd, cwd=cwd, shell=True, capture_output=True, text=True
        )
        return result.returncode, result.stdout, result.stderr
    except Exception as e:
        return 1, "", str(e)


# ---------- Middleware ----------
@app.before_request
def log_request():
    print(f"Request from {request.remote_addr} with URL {request.path}", flush=True)


# ---------- Routes ----------
@app.route("/")
def index():
    return send_from_directory(os.path.join(root_path, "static"), "index.html")

@app.route("/<path:filename>")
def serve_static(filename):
    return send_from_directory(STATIC_DIR, filename)

@app.route("/update", methods=["POST"], strict_slashes=False)
def update():
    print("Starting update from Git...", flush=True)
    socketio.start_background_task(target=do_update)
    return "Update started. Service will restart if update is successful.", 200


def do_update():
    code, out, err = run_command("sudo git pull", cwd=root_path)
    print(f"Git output: {out}, {err}", flush=True)
    if code == 0:
        print("Git pull complete. Restarting webui.service...", flush=True)
        run_command("sudo systemctl restart webui.service")
    else:
        print("Git pull failed.", flush=True)


@app.route("/reboot", methods=["POST"], strict_slashes=False)
def reboot():
    try:
        print("Rebooting now", flush=True)
        subprocess.Popen("sudo reboot now", shell=True)
        return "Rebooting now. Check back soon", 200
    except Exception as e:
        print(f"Error: {e}", flush=True)
        return f"Error rebooting: {e}", 500


@app.route("/motion/enable", methods=["POST"], strict_slashes=False)
def motion_enable():
    print(f"Enabling motion.py from {request.remote_addr}", flush=True)
    try:
        config = {};
        if os.path.exists(config_path):
            with open(config_path, "r") as f:
                config = json.load(f);
                config["enabled"] = True;
            with open(config_path, "w") as f:
                json.dump(config, f, indent=2);
    except Exception as e:
        print(f"Error writing motion config: {e}", flush=True);
        return "Failed to update config", 500;

    return start_motion();


@app.route("/motion/disable", methods=["POST"], strict_slashes=False)
def motion_disable():
    print(f"Disabling motion.py from {request.remote_addr}", flush=True)
    try:
        config = {}
        if os.path.exists(config_path):
            with open(config_path, "r") as f:
                config = json.load(f)
        config["enabled"] = False
        with open(config_path, "w") as f:
            json.dump(config, f, indent=2)
    except Exception as e:
        print(f"Error writing motion config: {e}", flush=True)
        return "Failed to update config", 500

    return stop_motion();


# TODO: Rewrite this to use correct POST
# Like this data = request.get_json()
# url = data.get("url", "")
@app.route("/motion/threshold/<value>", methods=["POST"], strict_slashes=False)
def motion_threshold(value):
    try:
        threshold = float(value)
    except ValueError:
        return "Invalid threshold", 400

    try:
        config = {}
        if os.path.exists(config_path):
            with open(config_path, "r") as f:
                config = json.load(f)
        config["threshold"] = threshold
        with open(config_path, "w") as f:
            json.dump(config, f, indent=2)
        print(f"Updated motion threshold to {threshold}", flush=True)

        # Use the new threshold value
        restart_motion();

        return "Threshold updated", 200
    except Exception as e:
        print(f"Error writing threshold: {e}", flush=True)
        return "Failed to update threshold", 500


@app.route("/motion/config")
def motion_config():
    if not os.path.exists(config_path):
        return jsonify({"error": "Motion config not found"}), 404
    try:
        with open(config_path, "r") as f:
            config = json.load(f)
        return jsonify(
            {"enabled": config.get("enabled"), "threshold": config.get("threshold")}
        )
    except Exception as e:
        return jsonify({"error": "Failed to read motion config"}), 500


@app.route("/screen/brightness/<int:value>", methods=["POST"], strict_slashes=False)
def screen_brightness(value):
    brightness_path = get_brightness_path()
    if not brightness_path:
        return "Brightness control not available", 500

    max_brightness = get_max_brightness(brightness_path)
    if max_brightness is not None and (value < 0 or value > max_brightness):
        return f"Brightness must be between 0 and {max_brightness}", 400

    code, _, err = run_command(f"echo {value} | sudo tee {brightness_path}")
    if code != 0:
        print(f"Failed to set brightness:{err}", flush=True)
        return "Failed to set brightness", 500

    print(f"Brightness set to {value}", flush=True)
    return "Brightness updated", 200


@app.route("/screen/brightness")
def get_brightness():
    brightness_path = get_brightness_path()
    if not brightness_path:
        return jsonify({"error": "Brightness control not available"}), 500

    max_brightness = get_max_brightness(brightness_path)
    if max_brightness is None:
        return jsonify({"error": "Unable to read max brightness"}), 500

    try:
        with open(brightness_path, "r") as f:
            current = int(f.read().strip())
        return jsonify({"current": current, "max": max_brightness})
    except Exception as e:
        print(f"Error reading current brightness: {e}", flush=True)
        return jsonify({"error": "Unable to read current brightness"}), 500


@app.route("/screen/timeout/<int:minutes>", methods=["POST"], strict_slashes=False)
def set_timeout(minutes):
    seconds = minutes * 60
    cmd = f"gsettings set org.gnome.desktop.session idle-delay {seconds}"
    code, _, err = run_command(cmd)
    if code != 0:
        return "Failed to set screen timeout in GNOME", 500
    return "GNOME screen timeout updated", 200


@app.route("/screen/timeout")
def get_timeout():
    code, out, err = run_command("gsettings get org.gnome.desktop.session idle-delay")
    if code != 0:
        return jsonify({"error": "Failed to read GNOME screen timeout"}), 500
    try:
        seconds = int(out.strip().split()[-1])
        minutes = seconds // 60
        return jsonify({"timeout": minutes})
    except Exception:
        return jsonify({"error": "Failed to parse timeout"}), 500


@app.route("/newhomescreen", methods=["POST"], strict_slashes=False)
def new_homescreen():
    try:
        data = request.get_json()
        url = data.get("url", "")
        if not os.path.exists(kiosk_path):
            raise FileNotFoundError(f"Kiosk can't be updated {kiosk_path}")

        with open(kiosk_path, "r") as f:
            lines = f.readlines()

        for i, line in enumerate(lines):
            if kiosk_config in line:
                parts = line.split(" ")
                parts[-1] = url + "\n";
                lines[i] = " ".join(parts)

        if not url:
            raise ValueError("Homescreen URL is blank")

        with open(kiosk_path, "w") as f:
            f.writelines(lines)

        return "Homescreen updated", 200
    except Exception as e:
        return jsonify({"error": "Could not update homescreen", "details": str(e)}), 500


@app.route("/homescreen")
def homescreen():
    try:
        if not os.path.exists(kiosk_path):
            raise FileNotFoundError(f"Kiosk file isn't found {kiosk_path}")

        with open(kiosk_path, "r") as f:
            for line in f:
                if kiosk_config in line:
                    homescreen_url = line.split(" ")[-1].strip()
                    if not homescreen_url:
                        raise ValueError("Homescreen URL is blank")
                    return jsonify({"url": homescreen_url}), 200

        raise ValueError("Homescreen URL not found in file")
    except Exception as e:
        return jsonify({"error": "Could not find homescreen", "details": str(e)}), 500


# ---------- Socket.IO ----------
@socketio.on("connect")
def handle_connect():
    print("Client connected", flush=True)


@socketio.on("disconnect")
def handle_disconnect():
    print("Client disconnected", flush=True)


@socketio.on("join")
def handle_join(room):
    print(f"Client joined room: {room}", flush=True)
    # flask_socketio join_room(room) if needed


# ---------- Startup ----------
if __name__ == "__main__":
    # Auto-start motion if enabled
    if os.path.exists(config_path):
        with open(config_path, "r") as f:
            config = json.load(f)
        if config.get("enabled"):
            run_com = root_path + "/venv/bin/python3 " + root_path + "/motion.py &";
            print(f"motion.py is enabled in config. Starting... with {run_com}", flush=True)
            # We need to change this to use the local
            start_motion();

    socketio.run(app, host="0.0.0.0", port=8080, allow_unsafe_werkzeug=True)
