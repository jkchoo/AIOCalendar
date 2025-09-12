# import the necessary packages
import cv2;
import gradio as gr;
import numpy as np;
import time;
from datetime import datetime;
import pyautogui;
#import matplotlib.pyplot as plt

# Log file location
logLoc = '~/motion/motion.log';
valLoc = "~/motion/values.log";

# How often I want to see the averageDifference
avgDiffCounter = 0;
# This is the limit in seconds(ish) Need to figure this timing out
avgDiffLimit = 10 * 60;

cameraResolution = {
    'width' : 160,
    'height' : 120
}

fontToUse = {
    'face': cv2.FONT_HERSHEY_PLAIN,
    'scale': 2,
    'color': (255,255,255),
    'lineType': cv2.LINE_AA,
    'thickness': 2
}

def detectMotion():
    # Open the camera stream
    try:
        global cameraResolution;
        cap = cv2.VideoCapture(0);
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, cameraResolution['width']);
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, cameraResolution['height']);

        # Get the FPS
        fps = cap.get(cv2.CAP_PROP_FPS)
        # Define FPS counter
        frameCounter = 0
        rollingAverage = []
        #print(fps)
        # Define the mean value of the webcam feed
        lastMeanValueOfFrame = 0

        # Define the threshold to detect motion
        #We need to read this in through a file
        threshold = 5

        # Start the loop
        while True:
            ret, frame = cap.read()
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            frameCounter += 1
            try:
                cv2.imshow('frame',frame)
                # This is needed to show the output of the camera
                if (cv2.waitKey(1) & 0xFF == ord('q')):
                    break
            except:
                print("Can't show the camera output")

        # Compute the difference
        diff = np.abs(np.mean(gray) - lastMeanValueOfFrame)
        rollingAverage.append(diff)
        #print(rollingAverage)
        print(diff)

        #print(gray)
        #print("\n\n\n")

        now = datetime.now()

        if diff > threshold:
            #print(f"Motion detected value {diff} at {now}")
            pyautogui.press('shift');
            global logLoc;
            global fontToUse;
            with open(logLoc, 'a') as file:
              file.write(f"Motion detected at {now} with a value of {np.floor(diff)}\n")
            curr = now.strftime("%y-%m-%d %H-%M-%S")
            imgFile = '/home/mirror/motion/'+curr+'.jpg'
            #print(imgFile)
            #newFrame = np.rot90(frame)
            cv2.putText(frame,
                    str(np.round(diff,1)),
                    (10, cameraResolution['height']-10),
                    fontToUse['face'],
                    fontToUse['scale'],
                    fontToUse['color'],
                    fontToUse['thickness'],
                    fontToUse['lineType'])
            cv2.imwrite(imgFile,np.rot90(frame))
        # Store the new difference
        lastMeanValueOfFrame = np.mean(frame)

        if frameCounter == fps:
            frameCounter = 0
            global avgDiffCounter;
            global avgDiffLimit;
            avgDiffCounter += 1;
            if avgDiffCounter == avgDiffLimit:
                avgDiffCounter = 0
                averageChange = np.mean(rollingAverage)
                # Clear out the rolling average
                rollingAverage = [];
                global valLoc;
                with open(valLoc, 'a') as file:
                    file.write(f"Average difference at {now} is {averageChange}\n")
            #print(f"{frameCounter} {avgDiffCounter}")

        #time.sleep(.125)
    except Exception as e:
        print(f"Crash from {e}")
        with open(logLoc, 'a') as file:
            now = datetime.now()
            file.write(f"Program crashed at {now} with error {e}\n")
    finally:
        # Release the camera
        cap.release()
        cv2.destroyAllWindows()
