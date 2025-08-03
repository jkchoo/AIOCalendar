const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const lr = require('line-reader');
const bodyParser = require('body-parser')

const app = express();
// const upload = multer({ dest: 'temp/' });

const rootPath = __dirname; // Get the root directory path
const configPath = path.join(rootPath, 'motion_config.json');

const homePath = fs.readFileSync(path.join(rootPath,'home_file.conf'), 'utf-8').split('\n')[0];
const kioskPath = path.join(homePath,'Kiosk.desktop');
const kioskConfig = "Exec=env MOZ_USE_XINPUT2=1 firefox --kiosk"

// We need to do this to access
app.use(bodyParser.json());
app.use(express.static(path.join(rootPath, 'public')));

//Log all of the requests to this service
app.use((req, res, next)=> {
  console.log("Request from " + req.socket.remoteAddress + " with URL " + req.originalUrl);
 next();
});


// Handle GET request for '/'
app.get('/', (req, res) => {
  res.sendFile(path.join(rootPath, 'public', 'index.html'));
});

// This endpoint will handle updating the system
app.post('/update', (req, res) => {
  console.log("Starting update from Git...");

  // Respond immediately to the web UI
  res.status(200).send("Update started. Service will restart if update is successful.");

  // Begin Git pull in background
  const gitPull = exec("sudo git pull", { cwd: rootPath });

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

// This will reboot the system
app.post('/reboot', (req, res) => {
  try
  {
    console.log("rebooting now");

    // Respond immediately to the web UI
    res.status(200).send("Rebooting now. Check back soon");

    // Reboot the system
    const rebootNow = exec("sudo reboot now");
  }
  catch(err)
  {
    console.error(err);
    res.status(500).send("Error rebooting: " + err);
  }

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
  const threshold = parseFloat(req.params.value);
  console.info("Getting new threshold as " + threshold);
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

// This will set the Screen Timeout
app.post('/screen/timeout/:minutes', (req, res) => {
  const minutes = parseInt(req.params.minutes, 10);
  if (isNaN(minutes)) return res.status(400).send('Invalid timeout value');

  const seconds = minutes * 60;

  // Check if we're in GNOME environment
  /*
  exec('echo $XDG_CURRENT_DESKTOP', (err, stdout) => {
    const isGnome = stdout.toLowerCase().includes('gnome');

    if (isGnome) {
  */
    const gsettingsCmd = `gsettings set org.gnome.desktop.session idle-delay ${seconds}`;
    console.log("Trying to set the screen timeout\n\t" + gsettingsCmd);
    exec(gsettingsCmd, (error, stdout, stderr) => {
      if (error) {
        console.error("GNOME timeout error:", error.message);
        return res.status(500).send("Failed to set screen timeout in GNOME");
      }
      console.log("GNOME screen timeout set to", minutes, "minutes");
      res.send("GNOME screen timeout updated");
    });
    /*
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
    } */
   //});
});

// This fetches the currently set Screen Timeout
app.get('/screen/timeout', (req, res) => {
  /*
  exec('echo $XDG_CURRENT_DESKTOP', (err, stdout) => {
    const isGnome = stdout.toLowerCase().includes('gnome');

    if (isGnome) {
  */
    exec("gsettings get org.gnome.desktop.session idle-delay", (error, stdout, stderr) => {
      if (error) {
        console.error("GNOME read timeout error:", error.message);
        return res.status(500).json({ error: "Failed to read GNOME screen timeout" });
      }

      const seconds = parseInt(stdout.trim().split(' ')[1], 10);
      const minutes = Math.floor(seconds / 60);
      console.log("GNOME Screen timeout is " + minutes);
      res.json({ timeout: minutes });
    });
    /*
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
          console.log("X11 Screen timeout is " + minutes);
          res.json({ timeout: minutes });
        } else {
          res.status(500).json({ error: 'Could not parse timeout from xset' });
        }
      });
    }
  });
  */
});

// This will set the home page of the AIO Calendar
app.post('/newhomescreen', (req, res) =>{
  try {
    let url = req.body.url;
    // Check if the file exists
    if (fs.existsSync(kioskPath))
    {
      let homescreenURL = "";
      // From here need to parse out the kiosk value
      console.info("Checking file lines")
      let file = fs.readFileSync(kioskPath, 'utf-8');
      let lines = file.split('\n');
      // Loop through the lines
      for(let i=0; i<lines.length; i++)
      {
            let line = lines[i];
            console.info("\t-"+line);
            // Check if it has the value we want
            if(line.search(kioskConfig) != -1)
            {
              let values = line.split(' ');
              values[values.length-1] = url;
              line = values.join(' ');
            }
      }
      // Make sure we got something
      if(homescreenURL == "")
      {
        throw new Error("Homescreen URL is blank");
      }
      else
      {
        file = lines.join('\n');
        fs.writeFileSync(kioskPath, file, {flag: 'a'});
        res.status(200);
      }
    }
    else
    {
      throw new Error("Kiosk file isn't found\t" + kioskPath);
    }
  } catch(exception) {
    console.error(exception.message)
    res.status(500).json(
      {
        error: 'Could not find homescreen',
        details: exception.message
      }
    );
  }
});

// This will retrieve the current home page of the AIO Calendar
app.get('/homescreen', (req, res) => {
  try {
    // Check if the file exists
    if (fs.existsSync(kioskPath))
    {
      let homescreenURL = "";
      // From here need to parse out the kiosk value
      console.info("Checking file lines")
      let file = fs.readFileSync(kioskPath, 'utf-8');
      let lines = file.split('\n');
      // Loop through the lines
      for(let i=0; i<lines.length; i++)
      {
            let line = lines[i];
            console.info("\t-"+line);
            // Check if it has the value we want
            if(line.search(kioskConfig) != -1)
            {
              let values = line.split(' ');
              homescreenURL = values[values.length-1];
            }
      }
      // Make sure we got something
      if(homescreenURL == "")
      {
        throw new Error("Homescreen URL is blank");
      }
      else
      {
        // Assume that we have the correct value now
        console.log(homescreenURL);
        res.status(200).json({url: homescreenURL});
      }
    }
    else
    {
      throw new Error("Kiosk file isn't found\t" + kioskPath);
    }
  } catch(exception) {
    console.error(exception.message)
    res.status(500).json(
      {
        error: 'Could not find homescreen',
        details: exception.message
      }
    );
  }
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
