# Audio server with multi device switching
This project is an audio server that allows you to switch between multiple audio devices seamlessly. It is built using Deno and leverages the power of WebSockets to sync audio playback across different devices.

This is meant to showcase how to rerceate the spotify connect feature using web technologies.

This is a work in progress and is not yet fully functional.


## Current functionality
- Launch the server next inside directory containing audio files
- open a browser and connect to the server
- all audio files in the directory will be listed
- audio status is reported to the server over websocket
- This WILL lag your computer if you have too many audio files


## runnning the server
> make sure you copy the `index.html` file to the directory containing your audio files. the index.ts file is just the backend code
```sh
deno run -A index.ts
```

## Showcase (Last updated Aug 23, 2025. hash: 0bca7d8)
https://github.com/user-attachments/assets/d679d769-cc4e-4c5b-b10d-0d24c2c71f34
