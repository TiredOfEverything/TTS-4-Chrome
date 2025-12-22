![Extension Status](https://img.shields.io/badge/status-active%20development-green)
![Chromium](https://img.shields.io/badge/Chromium-compatible-blue)

# Text-To-Speech For Chromium

This is a Chromium extension bringing Text-To-Speech with a proper interface to the platform, born from my frustrations with other TTS extensions currently available on Chrome's web store.
This project allows you to have pages read to you and highlights being spoken in real-time on the actual page itself.
The extension does not open a new popup, tab, or window to read the text elsewhere, nor does it require users to highlight text, or necessitate copying and pasting between interfaces.

To accomplish this, inspiration was heavily taken from Microsoft Edge's own Text-To-Speech system.

## How to Use It

### Quick Start
1. **Start reading**: Right-click and choose "Read Aloud"
2. **Control playback**: Use the toolbar that appears at the top
3. **Adjust settings**: Click the gear icon to change voice, speed, etc.

### Reading Options
- **Read entire page**: Right-click anywhere → "Read Aloud"
- **Read from a specific spot**: Right-click on selected text → "Read Aloud From Here"  
- **Read just selected text**: Select text containing more than 2 words → right-click → "Read Aloud Selection"

## This extension was built and tested using Chromium and Brave.

## Installation

This extension requires a Chromium-based browser (Google Chrome, Brave, Microsoft Edge, Vivaldi, Chromium, etc.).

### Manual Installation (Developer Mode)
Since this extension is not yet on the Chrome Web Store, you must install it manually:

1. **Download the source**:
   - Download the `.zip` from this page and extract it to a folder **OR**
   - Clone the repository to a local folder.
2. **Open the Extensions page**:
   - In your browser address bar, type `chrome://extensions` and press Enter.
3. **Enable Developer Mode**:
   - Look for a toggle switch named **"Developer mode"** in the top right corner and flip it **ON**.
4. **Load the extension**:
   - Click the **"Load unpacked"** button that appears at the top left corner.
   - Select the folder where you extracted/cloned the files.
5. **Done**:
   - The extension should now appear in your list and be ready to use.

*Note: Do not delete or move the folder after installation, or the extension will stop working.*

## Found a bug? [Report it here](https://github.com/TiredOfEverything/TTS-4-Chrome/issues)
