const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
// const upload = multer({ dest: 'temp/' });

const rootPath = __dirname; // Get the root directory path
const configPath = path.join(rootPath, 'motion_config.json');

app.use(express.static(path.join(rootPath, 'public')));

//Log all of the requests to this service
app.use((req, res, next)=> {
 console.log('I run on every request!');
 console.log("Request from " + req.socket.remoteAddress);
 next();
});


// Handle GET request for '/'
app.get('/', (req, res) => {
  console.log("Request from " + req.socket.remoteAddress);
  res.sendFile(path.join(rootPath, 'public', 'index.html'));
});

// This endpoint will handle updating the system
app.post('/update', (req, res) => {
  console.log("Starting update from Git...");

  // Respond immediately to the web UI
  res.status(200).send("Update started. Service will restart if update is successful.");

  // Begin Git pull in background
  const gitPull = exec("git pull", { cwd: rootPath });

  let gitOutput = '';

  gitPull.stdout.on('data', (data) => {
    console.log("Git stdout:", data.toString());
    gitOutput += data.toString();
  });

  gitPull.stderr.on('data', (data) => {
    console.error("Git stderr:", data.toString());
    gitOutput += data.toString();
  });

  gitPull.on('exit', (code) => {
    if (code === 0) {
      console.log("Git pull complete. Restarting webui.service...");
      const restartService = exec("sudo systemctl restart webui.service");

      restartService.on('exit', (restartCode) => {
        if (restartCode === 0) {
          console.log("Service restarted successfully.");
        } else {
          console.error("Failed to restart service.");
        }
      });

    } else {
      console.error("Git pull failed with code:", code);
    }
  });
});

// Enable the motion waking up feature
app.post('/motion/enable', (req, res) => {
  console.log("Enabling motion.py from " + req.socket.remoteAddress);

  // Update config
  const configPath = path.join(rootPath, 'motion_config.json');
  try{
    let config = {};
    if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath));
    }
    config.enabled = true;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (err) {
      console.error("Error writing motion config:", err);
      res.status(500).send("Failed to update config");
  }

  // Start motion.py
  exec("python3 /path/to/motion.py &", (error, stdout, stderr) => {
      if (error) {
          console.error("Failed to start motion.py:", error.message);
          return res.status(500).send("Failed to start motion.py");
      }      

      // Then we're good
      console.log("motion.py started and config updated");
      res.send("motion.py started");
  });
});

// Disable the motion waking up
app.post('/motion/disable', (req, res) => {
  console.log("Disabling motion.py from " + req.socket.remoteAddress);
 
  // Update config
  const configPath = path.join(rootPath, 'motion_config.json');
  try{
    let config = {};
    if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath));
    }
    config.enabled = false;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (err) {
      console.error("Error writing motion config:", err);
      res.status(500).send("Failed to update config");
  }

  // Stop motion.py
  exec("pkill -f motion.py", (error, stdout, stderr) => {
      if (error) {
          console.error("Failed to stop motion.py:", error.message);
          return res.status(500).send("Failed to stop motion.py");
      }

      try {
          res.send("motion.py stopped");
      } catch (err) {
          console.error("Error writing motion config:", err);
          res.status(500).send("Failed to update config");
      }
  });
});

// Set the motion threshold value
app.post('/motion/threshold/:value', (req, res) => {
  const threshold = parseInt(req.params.value, 10);
  if (isNaN(threshold)) {
      return res.status(400).send('Invalid threshold');
  }

  const configPath = path.join(rootPath, 'motion_config.json');
  try {
      let config = {};
      if (fs.existsSync(configPath)) {
          config = JSON.parse(fs.readFileSync(configPath));
      }
      config.threshold = threshold;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log("Updated motion threshold to", threshold);
      res.send('Threshold updated');
  } catch (err) {
      console.error("Error writing threshold:", err);
      res.status(500).send('Failed to update threshold');
  }
});

// Read the current motion threshold value
app.get('/motion/config', (req, res) => {
  const configPath = path.join(rootPath, 'motion_config.json');

  try {
    if (!fs.existsSync(configPath)) {
      return res.status(404).json({ error: 'Motion config not found' });
    }

    const configData = JSON.parse(fs.readFileSync(configPath));
    const response = {
      enabled: configData.enabled,
      threshold: configData.threshold
    };

    res.json(response);
  } catch (err) {
    console.error("Failed to read motion config:", err.message);
    res.status(500).json({ error: 'Failed to read motion config' });
  }
});

// This will change the screen brightness
app.post('/screen/brightness/:value', (req, res) => {
  const value = parseInt(req.params.value, 10);
  if (isNaN(value)) {
    return res.status(400).send('Invalid brightness value');
  }

  const brightnessPath = getBrightnessPath();
  if (!brightnessPath) {
    return res.status(500).send('Brightness control not available on this platform');
  }

  const maxBrightness = getMaxBrightness(brightnessPath);
  if (maxBrightness !== null && (value < 0 || value > maxBrightness)) {
    return res.status(400).send(`Brightness must be between 0 and ${maxBrightness}`);
  }

  const command = `echo ${value} | sudo tee ${brightnessPath}`;
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error("Failed to set brightness:", error.message);
      return res.status(500).send('Failed to set brightness');
    }
    console.log(`Brightness set to ${value}`);
    res.send('Brightness updated');
  });
});

// This will get the current and max brightness for the slider to use
app.get('/screen/brightness', (req, res) => {
  const brightnessPath = getBrightnessPath();
  if (!brightnessPath) {
    return res.status(500).json({ error: 'Brightness control not available' });
  }

  const maxBrightness = getMaxBrightness(brightnessPath);
  if (maxBrightness === null) {
    return res.status(500).json({ error: 'Unable to read max brightness' });
  }

  try {
    const currentBrightness = parseInt(fs.readFileSync(brightnessPath).toString(), 10);
    return res.json({
      current: currentBrightness,
      max: maxBrightness
    });
  } catch (err) {
    console.error("Error reading current brightness:", err.message);
    return res.status(500).json({ error: 'Unable to read current brightness' });
  }
});

app.post('/screen/timeout/:minutes', (req, res) => {
  const minutes = parseInt(req.params.minutes, 10);
  if (isNaN(minutes)) return res.status(400).send('Invalid timeout value');

  const seconds = minutes * 60;

  // Check if we're in GNOME environment
  exec('echo $XDG_CURRENT_DESKTOP', (err, stdout) => {
    const isGnome = stdout.toLowerCase().includes('gnome');

    if (isGnome) {
      const gsettingsCmd = `gsettings set org.gnome.desktop.session idle-delay ${seconds}`;
      exec(gsettingsCmd, (error, stdout, stderr) => {
        if (error) {
          console.error("GNOME timeout error:", error.message);
          return res.status(500).send("Failed to set screen timeout in GNOME");
        }
        console.log("GNOME screen timeout set to", minutes, "minutes");
        res.send("GNOME screen timeout updated");
      });
    } else {
      const xsetCmd = `xset dpms ${seconds} ${seconds} ${seconds}`;
      exec(xsetCmd, (error, stdout, stderr) => {
        if (error) {
          console.error("X11 timeout error:", error.message);
          return res.status(500).send("Failed to set screen timeout with xset");
        }
        console.log("X11 screen timeout set to", minutes, "minutes");
        res.send("X11 screen timeout updated");
      });
    }
  });
});

// This fetches the currently set Screen Timeout
app.get('/screen/timeout', (req, res) => {
  exec('echo $XDG_CURRENT_DESKTOP', (err, stdout) => {
    const isGnome = stdout.toLowerCase().includes('gnome');

    if (isGnome) {
      exec("gsettings get org.gnome.desktop.session idle-delay", (error, stdout, stderr) => {
        if (error) {
          console.error("GNOME read timeout error:", error.message);
          return res.status(500).json({ error: "Failed to read GNOME screen timeout" });
        }

        const seconds = parseInt(stdout.trim().replace(/\D/g, ''));
        const minutes = Math.floor(seconds / 60);
        res.json({ timeout: minutes });
      });
    } else {
      exec('xset q', (err, stdout) => {
        if (err) {
          console.error('X11 error reading xset:', err.message);
          return res.status(500).json({ error: 'Failed to read timeout with xset' });
        }

        const match = stdout.match(/Standby:\s+(\d+)/);
        const seconds = match ? parseInt(match[1]) : null;

        if (seconds !== null) {
          const minutes = Math.floor(seconds / 60);
          res.json({ timeout: minutes });
        } else {
          res.status(500).json({ error: 'Could not parse timeout from xset' });
        }
      });
    }
  });
});

app.post('/combine/:folderName', (req, res) => {
  console.log("Request from " + req.socket.remoteAddress);
  const folderName = req.params.folderName;
  //console.log("Received combination mode " + combineMode);

  var command = `./combine_images ${tempDirPath} ${outputPath}  ${combineMode}`;
  if (combineMode == "S") {
  	command = command + " 20";
  }
  console.log(command);
  // Execute the command and capture the output
  const childProcess = exec(command, { cwd: rootPath }); // Set the current working directory for the child process

  // Send the output to the client via socket.io
  const roomName = folderName; // Use the folderName as the roomName
  childProcess.stdout.on('data', (data) => {
    console.log(roomName + " process output " + data.toString());
    io.to(roomName).emit('output', data.toString()); // Emit the output to the specific room
  });

  childProcess.stderr.on('data', (data) => {
    console.log(roomName + " experienced error output " + data.toString());
    io.to(roomName).emit('output', data.toString()); // Emit the error to the specific room
  });

  childProcess.on('exit', (code) => {
    console.log('combine_images process exited with code', code);
    if (code === 0) {
      console.log('Image combination completed');
      res.download(outputPath, 'combined_image.jpg', (err) => {
        if (err) {
          console.error('Download error:', err);
        }
        fs.readdirSync(tempDirPath).forEach((file) => {
          const filePath = path.join(tempDirPath, file);
          if (fs.lstatSync(filePath).isDirectory()) {
            fs.rmdirSync(filePath, { recursive: true });
          } else {
            fs.unlinkSync(filePath);
          }
        });
        // Remove the temporary directory
        fs.rmdirSync(tempDirPath, { recursive: true, force: true });
        // Remove the output file if desired
        // fs.unlinkSync(outputPath);
      });
    } else {
      console.error('combine_images process encountered an error');
      res.sendStatus(500);
    }
  });
});

// Set up socket.io
const server = require('http').Server(app);
const io = require('socket.io')(server);




// Socket.io connection event
io.on('connection', (socket) => {
  console.log('Client connected');

  // Handle socket disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });

  // Handle joining a room
  socket.on('join', (room) => {
    console.log(`Client joined room: ${room}`);
    socket.join(room);
  });
});

server.listen(80, () => {
  console.log('Server started on port 80');
});


// Auto start motion.py if it's configured for that
if (fs.existsSync(configPath)) {
  const config = JSON.parse(fs.readFileSync(configPath));
  if (config.enabled) {
      console.log("motion.py is enabled in config. Starting...");
      exec("python3 /path/to/motion.py &", (error, stdout, stderr) => {
          if (error) {
              console.error("Failed to auto-start motion.py:", error.message);
          } else {
              console.log("motion.py auto-started");
          }
      });
  }
}


// Handle looking up where the brightness is defined
function getBrightnessPath() {
  const basePath = '/sys/class/backlight';
  try {
    const entries = fs.readdirSync(basePath);
    if (entries.length === 0) return null;
    const first = entries[0]; // Use the first available backlight device
    return path.join(basePath, first, 'brightness');
  } catch (err) {
    console.error("Unable to locate brightness control:", err.message);
    return null;
  }
}

// Check what the max brightness for this device is 
function getMaxBrightness(pathToDevice) {
  try {
    const maxPath = pathToDevice.replace('/brightness', '/max_brightness');
    return parseInt(fs.readFileSync(maxPath).toString(), 10);
  } catch (err) {
    console.warn("Could not read max_brightness");
    return null;
  }
}