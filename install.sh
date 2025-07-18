# Initial setup
sudo apt update;
sudo apt upgrade -y;

# Python stuff
sudo apt install build-essential libpq-dev libssl-dev openssl libffi-dev zlib1g-dev -y;
sudo apt install python3.12 python3-pip python3.12-dev -y;
sudo apt install python3-dev libxml2-dev libxslt-dev -y;
sudo apt install python3-setuptools -y;
sudo apt install python-all-dev -y;
sudo easy_install3 pip -y; 
sudo pip3 install opencv-python -y;
sudo pip3 install numpy -y;
sudo pip3 install pyautogui -y;
sudo apt install libevent-dev -y;
sudo pip3 install eventlet -y;

# We'll want GIT for later
sudo apt install git -y;

# Install Node
sudo apt install nodejs npm -y
# Install Express.js, Multer, fs-extra, and Socket.IO
npm install express multer fs-extra socket.io;

# Allow default node to listen on port 80
sudo apt-get install libcap2-bin -y;
sudo setcap cap_net_bind_service=+ep `readlink -f \`which node\``;


# Set up the webservice
# Constants
SERVICE_NAME="webui.service"
SERVICE_PATH="/etc/systemd/system/$SERVICE_NAME"
USER_NAME="$(whoami)"
PROJECT_DIR="$(pwd)"
DISPLAY_NUM=":0"
XAUTH_PATH="/home/$USER_NAME/.Xauthority"

# Create the service file content
cat <<EOF | sudo tee "$SERVICE_PATH" > /dev/null
[Unit]
Description=Web UI Node.js Service with X11 Access
After=network.target graphical.target

[Service]
User=$USER_NAME
WorkingDirectory=$PROJECT_DIR
ExecStart=/usr/bin/node server.js
Environment=DISPLAY=$DISPLAY_NUM
Environment=XAUTHORITY=$XAUTH_PATH
Restart=on-failure

[Install]
WantedBy=default.target
EOF

# Set correct permissions
sudo chmod 644 "$SERVICE_PATH"

# Reload systemd to pick up the new service
echo "Reloading systemd..."
sudo systemctl daemon-reexec
sudo systemctl daemon-reload

# Enable and start the service
echo "Enabling and starting $SERVICE_NAME..."
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl start "$SERVICE_NAME"

# Show status
echo "Service status:"
sudo systemctl status "$SERVICE_NAME" --no-pager