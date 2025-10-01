#!/bin/bash
set -e

# -------- Initial setup --------
echo "[*] Updating system..."
sudo apt update
sudo apt upgrade -y

# -------- System dependencies --------
echo "[*] Installing system dependencies..."
sudo apt install -y \
  build-essential \
  libpq-dev \
  libssl-dev \
  openssl \
  libffi-dev \
  zlib1g-dev \
  python3 \
  python3-venv \
  python3-pip \
  python3-dev \
  libxml2-dev \
  libxslt-dev \
  libevent-dev \
  git

# -------- Constants --------
SERVICE_NAME="webui.service"
SERVICE_PATH="/etc/systemd/system/$SERVICE_NAME"
USER_NAME="$(whoami)"
PROJECT_DIR="$(pwd)"
DISPLAY_NUM=":0"
XAUTH_PATH="/home/$USER_NAME/.Xauthority"
VENV_DIR="$PROJECT_DIR/venv"

# -------- Virtual Environment --------
if [ ! -d "$VENV_DIR" ]; then
    echo "[*] Creating virtual environment in $VENV_DIR..."
    python3 -m venv "$VENV_DIR"
else
    echo "[*] Virtual environment already exists at $VENV_DIR"
fi

# -------- Python Requirements --------
echo "[*] Installing Python packages into venv..."
source "$VENV_DIR/bin/activate"

pip install --upgrade pip
pip install \
  flask \
  flask-socketio \
  eventlet \
  opencv-python \
  numpy \
  pyautogui

deactivate

# -------- Systemd Service --------
echo "[*] Creating systemd service $SERVICE_NAME..."
cat <<EOF | sudo tee "$SERVICE_PATH" > /dev/null
[Unit]
Description=Web UI Flask Service with X11 Access
After=network.target graphical.target

[Service]
User=$USER_NAME
WorkingDirectory=$PROJECT_DIR
ExecStart=$PROJECT_DIR/venv/bin/python $PROJECT_DIR/server.py
Environment=DISPLAY=$DISPLAY_NUM
Environment=XAUTHORITY=$XAUTH_PATH
Restart=on-failure

[Install]
WantedBy=default.target
EOF

# --------Motion Service------------
echo "[*] Creating motion systemd service file..."
MOTION_SERVICE_NAME="motion.service"
MOTION_SERVICE_PATH="/etc/systemd/system/$MOTION_SERVICE_NAME"
cat <<EOF | sudo tee "$MOTION_SERVICE_PATH" > /dev/null
[Unit]
Description=Motion Service (Python motion.py)
After=network.target graphical.target

[Service]
User=$USER_NAME
WorkingDirectory=$PROJECT_DIR
ExecStart=$PROJECT_DIR/venv/bin/python3 $PROJECT_DIR/motion.py
Environment=DISPLAY=$DISPLAY_NUM
Environment=XAUTHORITY=$XAUTH_PATH
Restart=on-failure

[Install]
WantedBy=default.target
EOF

sudo chmod 644 "$MOTION_SERVICE_PATH"

echo "[*] Reloading systemd for motion service..."
sudo systemctl daemon-reload

echo "[*] Enabling and starting $MOTION_SERVICE_NAME..."
sudo systemctl enable "$MOTION_SERVICE_NAME"
sudo systemctl restart "$MOTION_SERVICE_NAME"

echo "[*] Checking motion service status..."
sudo systemctl status "$MOTION_SERVICE_NAME" --no-pager || true

# -------- Permissions & Reload --------
sudo chmod 644 "$SERVICE_PATH"

echo "[*] Reloading systemd..."
sudo systemctl daemon-reexec
sudo systemctl daemon-reload

# -------- Enable & Start Service --------
echo "[*] Enabling and starting $SERVICE_NAME..."
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

# -------- Status --------
echo "[*] Checking service status..."
sudo systemctl status "$SERVICE_NAME" --no-pager || true

# -------- Autostart setup --------
AUTOSTART_DIR="/home/$USER_NAME/.config/autostart"
mkdir -p "$AUTOSTART_DIR"
cp Kiosk.desktop "$AUTOSTART_DIR/"

echo "$AUTOSTART_DIR" > home_file.conf

echo "[✔] Installation complete!"
