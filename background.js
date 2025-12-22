// background.js

let runningTTS = false;
let isPaused = false;
let activeTtsTabId = null;
let selectionOnly = false;
let currentSentenceText = "";

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({ id: "readAloud", title: "Read Aloud", contexts: ["page"] });
    chrome.contextMenus.create({ id: "readAloudFromHere", title: "Read Aloud From Here", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "readAloudSelection", title: "Read Aloud Selection", contexts: ["selection"], visible: false });
    chrome.contextMenus.create({ id: "closeReadAloud", title: "Close Read Aloud", contexts: ["page"], visible: false });
});

async function handleTtsEvent(event) {
    if (event.type === 'word') {
        if (activeTtsTabId !== null) {
            chrome.tabs.sendMessage(activeTtsTabId, {
                action: "highlightWord",
                charIndex: event.charIndex
            }).catch(() => {});
        }
    } else if (event.type === 'end') {
        handleAudioEnded();
    } else if (event.type === 'error') {
        console.error("TTS Error:", event.errorMessage);
        stopTTS();
    }
}

async function handleAudioEnded() {
    console.log("Audio finished playing naturally.");

    if (selectionOnly) {
        stopTTS();
        if (activeTtsTabId) chrome.tabs.sendMessage(activeTtsTabId, { action: "close-toolbar" }).catch(() => {});
        selectionOnly = false;
        return;
    }

    if (activeTtsTabId !== null) {
        try {
            const response = await chrome.tabs.sendMessage(activeTtsTabId, { action: "getNextBlock" });
            const nextText = response?.text;

            if (!nextText || !nextText.trim()) {
                console.log("Reached end of content. Stopping.");
                stopTTS();
                chrome.tabs.sendMessage(activeTtsTabId, { action: "close-toolbar" }).catch(() => {});
                return;
            }

            await runTTS(nextText);
        } catch (error) {
            console.error("Error during transition to next block:", error);
            stopTTS();
        }
    } else {
        stopTTS();
    }
}

async function runTTS(textToSpeak) {
    chrome.tts.stop();

    const settings = await chrome.storage.sync.get({
        voice: null,
        rate: "1.0",
        pitch: "1.0"
    });
    
    let rate = parseFloat(settings.rate);
    if (isNaN(rate)) rate = 1.0;

    let pitch = parseFloat(settings.pitch);
    if (isNaN(pitch)) pitch = 1.0;

    const options = {
        rate: rate,
        pitch: pitch,
        onEvent: handleTtsEvent
    };

    if (settings.voice) {
        options.voiceName = settings.voice;
    }

    if (activeTtsTabId) {
        chrome.tabs.sendMessage(activeTtsTabId, {
            action: "startBlockPlayback",
            text: textToSpeak 
        }).catch(() => {});
    }

    currentSentenceText = textToSpeak;
    runningTTS = true;
    isPaused = false;
    pushUiUpdate();

    chrome.tts.speak(textToSpeak, options);
}

function stopTTS(preserveTabId = false) {
    chrome.tts.stop();
    runningTTS = false;
    isPaused = false;
    currentSentenceText = "";
    pushUiUpdate();

    if (!preserveTabId) {
        activeTtsTabId = null;
    }
}

function pauseTTS() {
    if (runningTTS && !isPaused) {
        chrome.tts.pause();
        isPaused = true;
        pushUiUpdate();
    }
}

function resumeTTS() {
    if (runningTTS && isPaused) {
        chrome.tts.resume();
        isPaused = false;
        pushUiUpdate();
    }
}

function pushUiUpdate() {
    if (activeTtsTabId === null) return;
    const currentState = { runningTTS, isPaused };
    chrome.tabs.sendMessage(activeTtsTabId, {
        action: "updateUiState",
        state: currentState
    }).catch(error => {
        if (runningTTS) stopTTS();
    });
}

async function startPlayback(tabId) {
    try {
        selectionOnly = false;
        const response = await chrome.tabs.sendMessage(tabId, { action: "getFirstBlock" });
        if (response?.text?.trim()) {
            activeTtsTabId = tabId;
            await runTTS(response.text);
            await chrome.tabs.sendMessage(tabId, { action: "open-toolbar" });
        }
    } catch (error) {
        console.error("Error starting playback:", error);
    }
}

function handlePlayPauseToggle() {
    if (runningTTS) {
        if (isPaused) resumeTTS();
        else pauseTTS();
    } else if (activeTtsTabId) {
        startPlayback(activeTtsTabId);
    } else {
         chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) startPlayback(tabs[0].id);
         });
    }
}

async function handleNext() {
    if (activeTtsTabId !== null && runningTTS) {
        chrome.tts.stop(); 
        try {
            const res = await chrome.tabs.sendMessage(activeTtsTabId, { action: "getNextBlock" });
            if (res?.text?.trim()) await runTTS(res.text);
            else {
                stopTTS();
                chrome.tabs.sendMessage(activeTtsTabId, { action: "close-toolbar" });
            }
        } catch (err) { stopTTS(); }
    }
}

async function handlePrevious() {
    if (activeTtsTabId !== null && runningTTS) {
        chrome.tts.stop();
        try {
            const res = await chrome.tabs.sendMessage(activeTtsTabId, { action: "getPreviousBlock" });
            if (res?.text?.trim()) await runTTS(res.text);
            else pushUiUpdate();
        } catch (err) { stopTTS(); }
    }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;
    switch (info.menuItemId) {
        case "readAloud": await startPlayback(tab.id); break;
        case "readAloudFromHere":
            selectionOnly = false;
            if (info.selectionText?.trim()) {
                activeTtsTabId = tab.id;
                chrome.tabs.sendMessage(tab.id, { action: "getBlockContainingSelection", selectionText: info.selectionText.trim() })
                    .then(res => { if (res?.text?.trim()) { runTTS(res.text); chrome.tabs.sendMessage(tab.id, { action: "open-toolbar" }); }});
            }
            break;
        case "readAloudSelection":
            if (info.selectionText?.trim()) {
                selectionOnly = true;
                activeTtsTabId = tab.id;
                runTTS(info.selectionText);
                chrome.tabs.sendMessage(tab.id, { action: "open-toolbar" });
            }
            break;
        case "closeReadAloud": stopTTS(); chrome.tabs.sendMessage(tab.id, { action: "close-toolbar" }); break;
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch(message.action) {
        case "playButton": handlePlayPauseToggle(); break;
        case "nextButton": handleNext(); break;
        case "prevButton": handlePrevious(); break;
        case "stopTTS": stopTTS(); break;
    }
});

chrome.commands.onCommand.addListener((command) => {
    switch (command) {
        case "toggle-play-pause": handlePlayPauseToggle(); break;
        case "next-block": handleNext(); break;
        case "previous-block": handlePrevious(); break;
    }
});