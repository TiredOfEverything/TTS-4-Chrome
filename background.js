// background.js

let runningTTS = false;
let isPaused = false;
let activeTtsTabId = null;
let selectionOnly = false;
let currentSentenceText = "";
let pendingTextToSpeak = null;
let resumeFromCurrentPosition = false;
let currentBlockIndex = -1;
let currentSentenceIndex = -1;

async function loadState() {
    try {
        const stored = await chrome.storage.local.get(['ttsState']);
        if (stored.ttsState) {
            runningTTS = stored.ttsState.runningTTS ?? false;
            isPaused = stored.ttsState.isPaused ?? false;
            activeTtsTabId = stored.ttsState.activeTtsTabId ?? null;
            resumeFromCurrentPosition = stored.ttsState.resumeFromCurrentPosition ?? false;
            currentSentenceText = stored.ttsState.currentSentenceText ?? "";
            currentBlockIndex = stored.ttsState.currentBlockIndex ?? -1;
            currentSentenceIndex = stored.ttsState.currentSentenceIndex ?? -1;
            console.log("TTS state restored:", { runningTTS, isPaused, activeTtsTabId, resumeFromCurrentPosition, currentSentenceText, currentBlockIndex, currentSentenceIndex });
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
                resumeFromCurrentPosition,
                currentSentenceText,
                currentBlockIndex,
                currentSentenceIndex
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

            if (isPaused) {
                pendingTextToSpeak = nextText;
                pushUiUpdate();
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
    // Sync indices from content script after starting TTS
    syncIndicesFromContentScript().catch(() => {});
}

function stopTTS(preserveTabId = false) {
    chrome.tts.stop();
    runningTTS = false;
    isPaused = false;
    currentSentenceText = "";
    pendingTextToSpeak = null;
    resumeFromCurrentPosition = false;
    currentBlockIndex = -1;
    currentSentenceIndex = -1;
    pushUiUpdate();

    if (!preserveTabId) {
        activeTtsTabId = null;
    }
    saveState();
}

async function getIndicesFromContentScript(tabId) {
    if (!tabId) return { currentBlockIndex: -1, currentSentenceIndex: -1 };
    try {
        const response = await chrome.tabs.sendMessage(tabId, { action: "getIndices" });
        return response || { currentBlockIndex: -1, currentSentenceIndex: -1 };
    } catch (error) {
        console.warn("Failed to get indices from content script:", error);
        return { currentBlockIndex: -1, currentSentenceIndex: -1 };
    }
}

async function syncIndicesFromContentScript() {
    if (!activeTtsTabId) return;
    const indices = await getIndicesFromContentScript(activeTtsTabId);
    currentBlockIndex = indices.currentBlockIndex;
    currentSentenceIndex = indices.currentSentenceIndex;
    saveState();
}

async function pauseTTS() {
    if (runningTTS && !isPaused) {
        // Get current indices from content script before pausing
        const indices = await getIndicesFromContentScript(activeTtsTabId);
        currentBlockIndex = indices.currentBlockIndex;
        currentSentenceIndex = indices.currentSentenceIndex;
        
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
            runTTS(pendingTextToSpeak);
        } else {
            // Ensure content script has correct indices
            if (activeTtsTabId) {
                chrome.tabs.sendMessage(activeTtsTabId, {
                    action: "setIndices",
                    currentBlockIndex: currentBlockIndex,
                    currentSentenceIndex: currentSentenceIndex
                }).catch(() => {});
            }
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

async function handlePlayPauseToggle() {
    if (runningTTS) {
        if (isPaused) resumeTTS();
        else pauseTTS();
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
            // Try to find block by stored text first
            let textToSpeak = null;
            if (currentSentenceText) {
                try {
                    const findResponse = await chrome.tabs.sendMessage(activeTtsTabId, {
                        action: "findBlockByExactText",
                        text: currentSentenceText
                    });
                    if (findResponse?.found) {
                        textToSpeak = currentSentenceText;
                        currentBlockIndex = findResponse.blockIndex;
                        currentSentenceIndex = findResponse.sentenceIndex;
                        saveState();
                    }
                } catch (e) {
                    console.warn("findBlockByExactText failed:", e);
                }
            }
            if (!textToSpeak) {
                const response = await chrome.tabs.sendMessage(activeTtsTabId, { action: "getCurrentBlock" });
                if (response?.text?.trim()) {
                    textToSpeak = response.text;
                }
            }
            if (textToSpeak) {
                runningTTS = true;
                isPaused = false;
                resumeFromCurrentPosition = false;
                await runTTS(textToSpeak);
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
        case "contentScriptReady":
            const tabId = sender.tab?.id;
            if (tabId && tabId === activeTtsTabId && resumeFromCurrentPosition && currentSentenceText) {
                // Send stored indices and try to find block by exact text
                chrome.tabs.sendMessage(tabId, {
                    action: "setIndices",
                    currentBlockIndex: currentBlockIndex,
                    currentSentenceIndex: currentSentenceIndex
                }).catch(() => {});
                chrome.tabs.sendMessage(tabId, {
                    action: "findBlockByExactText",
                    text: currentSentenceText
                }).then(response => {
                    if (response?.found) {
                        console.log("Found stored block after content script ready");
                        // Update stored indices with found ones (they might be more accurate)
                        currentBlockIndex = response.blockIndex;
                        currentSentenceIndex = response.sentenceIndex;
                        saveState();
                    }
                }).catch(() => {});
            }
            break;
    }
});

chrome.commands.onCommand.addListener((command) => {
    switch (command) {
        case "toggle-play-pause": handlePlayPauseToggle(); break;
        case "next-block": handleNext(); break;
        case "previous-block": handlePrevious(); break;
    }
});