// background.js

let runningTTS = false;
let isPaused = false;
let activeTtsTabId = null;
let selectionOnly = false;
let currentSentenceText = "";
let pendingTextToSpeak = null;
let resumeFromCurrentPosition = false;
let ttsWatchdogTimer = null;

async function loadState() {
    try {
        const stored = await chrome.storage.local.get(['ttsState']);
        if (stored.ttsState) {
            runningTTS = stored.ttsState.runningTTS ?? false;
            isPaused = stored.ttsState.isPaused ?? false;
            activeTtsTabId = stored.ttsState.activeTtsTabId ?? null;
            resumeFromCurrentPosition = stored.ttsState.resumeFromCurrentPosition ?? false;
            console.log("TTS state restored:", { runningTTS, isPaused, activeTtsTabId, resumeFromCurrentPosition });
        }
    } catch (e) {
        console.error("Failed to load TTS state:", e);
    }
}

async function saveState() {
    try {
        await chrome.storage.local.set({
            ttsState: {
                runningTTS,
                isPaused,
                activeTtsTabId,
                resumeFromCurrentPosition
            }
        });
    } catch (e) {
        console.error("Failed to save TTS state:", e);
    }
}

loadState();

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({ id: "readAloud", title: "Read Aloud", contexts: ["page"] });
    chrome.contextMenus.create({ id: "readAloudFromHere", title: "Read Aloud From Here", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "readAloudSelection", title: "Read Aloud Selection", contexts: ["selection"], visible: false });
    chrome.contextMenus.create({ id: "closeReadAloud", title: "Close Read Aloud", contexts: ["page"], visible: false });
});

async function handleTtsEvent(event) {
    if (event.type === 'word') {
        clearTimeout(ttsWatchdogTimer);
        ttsWatchdogTimer = null;
        if (activeTtsTabId !== null) {
            chrome.tabs.sendMessage(activeTtsTabId, {
                action: "highlightWord",
                charIndex: event.charIndex
            }).catch(() => {});
        }
    } else if (event.type === 'end') {
        clearTimeout(ttsWatchdogTimer);
        ttsWatchdogTimer = null;
        handleAudioEnded();
    } else if (event.type === 'error') {
        clearTimeout(ttsWatchdogTimer);
        ttsWatchdogTimer = null;
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
            if (isPaused) {
                // When paused, peek at the next block WITHOUT advancing the index.
                // The index will advance in resumeTTS() when playback actually continues.
                const response = await chrome.tabs.sendMessage(activeTtsTabId, { action: "peekNextBlock" });
                const nextText = response?.text;

                if (!nextText || !nextText.trim()) {
                    console.log("Reached end of content while paused. Stopping.");
                    stopTTS();
                    chrome.tabs.sendMessage(activeTtsTabId, { action: "close-toolbar" }).catch(() => {});
                    return;
                }

                pendingTextToSpeak = nextText;
                pushUiUpdate();
                return;
            }

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
    pendingTextToSpeak = null;

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
    saveState();

    chrome.tts.speak(textToSpeak, options);
}

function stopTTS(preserveTabId = false) {
    clearTimeout(ttsWatchdogTimer);
    ttsWatchdogTimer = null;
    chrome.tts.stop();
    runningTTS = false;
    isPaused = false;
    currentSentenceText = "";
    pendingTextToSpeak = null;
    resumeFromCurrentPosition = false;
    pushUiUpdate();

    if (!preserveTabId) {
        activeTtsTabId = null;
    }
    saveState();
}

function pauseTTS() {
    if (runningTTS && !isPaused) {
        chrome.tts.pause();
        isPaused = true;
        resumeFromCurrentPosition = true;
        pushUiUpdate();
        saveState();
    }
}

async function resumeTTS() {
    if (runningTTS && isPaused) {
        if (pendingTextToSpeak) {
            // Advance the index now that we're actually continuing playback.
            // handleAudioEnded peeked (didn't advance) while paused, so we
            // advance here to keep indices in sync with the text being spoken.
            let textToSpeak;
            if (activeTtsTabId !== null) {
                try {
                    const response = await chrome.tabs.sendMessage(activeTtsTabId, { action: "getNextBlock" });
                    textToSpeak = response?.text;
                } catch (e) {
                    textToSpeak = pendingTextToSpeak;
                }
            } else {
                textToSpeak = pendingTextToSpeak;
            }
            pendingTextToSpeak = null;
            if (textToSpeak && textToSpeak.trim()) {
                await runTTS(textToSpeak);
            } else {
                stopTTS();
            }
        } else {
            // Resume the paused utterance. If Chrome's TTS engine has
            // dropped the utterance (common after long pauses), no events
            // will fire and the extension will appear stuck. The caller
            // (handlePlayPauseToggle) should detect this via word-event
            // timeout if it occurs.
            chrome.tts.resume();
            isPaused = false;
            resumeFromCurrentPosition = true;
            pushUiUpdate();
            saveState();
        }
    }
}

function pushUiUpdate() {
    if (activeTtsTabId === null) return;
    const currentState = { runningTTS, isPaused };
    chrome.tabs.sendMessage(activeTtsTabId, {
        action: "updateUiState",
        state: currentState
    }).catch(error => {
        // Don't stop TTS on UI update errors - they might be transient
        // Just log the error and continue
        console.warn("Failed to update UI state:", error);
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

async function handleRecoveryPlay() {
    // Called when TTS appears to have been dropped by Chrome after a long
    // pause or service-worker restart. Restart from the current block.
    if (!activeTtsTabId) return;
    try {
        const response = await chrome.tabs.sendMessage(activeTtsTabId, { action: "getCurrentBlock" });
        if (response?.text?.trim()) {
            await runTTS(response.text);
        } else {
            // Current block is empty, try starting fresh
            stopTTS();
            await startPlayback(activeTtsTabId);
        }
    } catch (error) {
        console.log("Recovery failed, starting fresh:", error.message);
        const tabId = activeTtsTabId;
        stopTTS();
        await startPlayback(tabId);
    }
}

async function handlePlayPauseToggle() {
    if (runningTTS) {
        if (isPaused) {
            if (pendingTextToSpeak) {
                // handleAudioEnded fired while paused; resume with the pending next block
                await resumeTTS();
            } else {
                // Normal resume. If Chrome's TTS dropped the utterance (long
                // pause / service-worker restart), resumeTTS will call
                // chrome.tts.resume() which is a no-op. Detect that by
                // listening for word events — if none arrive within 2 s we
                // fall through to a fresh start.
                await resumeTTS();
                // Set a watchdog: if no word event arrives in 2s, restart
                // from the current position.
                if (!pendingTextToSpeak) {
                    clearTimeout(ttsWatchdogTimer);
                    ttsWatchdogTimer = setTimeout(() => {
                        if (runningTTS && !isPaused) {
                            console.log("TTS watchdog: no word events after resume, restarting from current position.");
                            handleRecoveryPlay();
                        }
                    }, 2000);
                }
            }
        } else {
            pauseTTS();
        }
    } else if (activeTtsTabId && resumeFromCurrentPosition) {
        try {
            const tab = await chrome.tabs.get(activeTtsTabId);
            if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) {
                console.log("Tab no longer valid, starting fresh");
                activeTtsTabId = null;
                resumeFromCurrentPosition = false;
                saveState();
                startPlayback(null);
                return;
            }
            const response = await chrome.tabs.sendMessage(activeTtsTabId, { action: "getCurrentBlock" });
            if (response?.text?.trim()) {
                runningTTS = true;
                isPaused = false;
                resumeFromCurrentPosition = false;
                await runTTS(response.text);
            } else {
                startPlayback(activeTtsTabId);
            }
        } catch (error) {
            console.log("Error resuming, starting fresh:", error.message);
            activeTtsTabId = null;
            resumeFromCurrentPosition = false;
            saveState();
            startPlayback(null);
        }
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