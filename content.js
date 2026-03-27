// content.js

const styleEl = document.createElement("style");
styleEl.textContent = `
  .readAloudHighlight {
    background-color: var(--read-aloud-highlight-color, LightBlue) !important;
  }
  .readAloudWordHighlight {
    background-color: var(--read-aloud-word-highlight-color, yellow) !important;
    color: black !important;
    border-radius: 2px;
  }
  .read-aloud-reading-line {
      position: fixed;
      left: 0;
      width: 100%;
      height: 4px;
      z-index: 2147483647;
      cursor: ns-resize;
      display: flex;
      align-items: center;
  }
  .read-aloud-reading-line::before {
      content: '';
      width: 100%;
      height: 2px;
      position: absolute;
      top: 1px;
  }
  .read-aloud-reading-line::after {
      content: attr(data-label);
      position: absolute;
      right: 10px;
      background: rgba(0,0,0,0.7);
      color: white;
      padding: 2px 6px;
      font-size: 12px;
      border-radius: 4px;
      pointer-events: none;
  }
  #read-aloud-top-line::before { background-color: #00ff00; border-bottom: 1px dashed black; }
  #read-aloud-bottom-line::before { background-color: #ff0000; border-bottom: 1px dashed black; }
`;
document.head.appendChild(styleEl);

let readingAreaTop = 20; // Default percentage
let readingAreaBottom = 80; // Default percentage

async function applyHighlightColors() {
    try {
        const settings = await chrome.storage.sync.get({
            highlightColor: '#add8e6',
            highlightTransparency: 25,
            wordHighlightColor: '#ffff00',
            wordHighlightTransparency: 100,
            readingAreaTop: 20,
            readingAreaBottom: 80
        });
        
        const baseColor = settings.highlightColor;
        const transparency = settings.highlightTransparency;
        const alpha = transparency / 100;
        let cssColorValue = applyColorWithAlpha(baseColor, alpha);
        document.documentElement.style.setProperty('--read-aloud-highlight-color', cssColorValue);
        
        const wordBaseColor = settings.wordHighlightColor;
        const wordTransparency = settings.wordHighlightTransparency;
        const wordAlpha = wordTransparency / 100;
        let wordCssColorValue = applyColorWithAlpha(wordBaseColor, wordAlpha);
        document.documentElement.style.setProperty('--read-aloud-word-highlight-color', wordCssColorValue);
        
        readingAreaTop = parseFloat(settings.readingAreaTop);
        readingAreaBottom = parseFloat(settings.readingAreaBottom);

    } catch (e) {
        console.error("Read Aloud: Could not apply highlight colors.", e);
    }
}

function applyColorWithAlpha(baseColor, alpha) {
    let cssColorValue = `rgba(0, 0, 0, ${alpha})`;
    if (baseColor.startsWith("#") && baseColor.length === 7) {
        const r = parseInt(baseColor.slice(1, 3), 16);
        const g = parseInt(baseColor.slice(3, 5), 16);
        const b = parseInt(baseColor.slice(5, 7), 16);
        cssColorValue = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    } else {
        cssColorValue = baseColor;
    }
    return cssColorValue;
}

applyHighlightColors();

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
        if (changes.highlightColor || changes.highlightTransparency || 
            changes.wordHighlightColor || changes.wordHighlightTransparency) {
            applyHighlightColors();
        }
        if (changes.readingAreaTop) readingAreaTop = parseFloat(changes.readingAreaTop.newValue);
        if (changes.readingAreaBottom) readingAreaBottom = parseFloat(changes.readingAreaBottom.newValue);
    }
});

// Normalized text for TTS and Word Mapping (Preserves Case)
function normalizeKeepCase(str) {
	return str
		.replace(/\[[0-9]+\]/g, "")
		.replace(/\/[^\/]+\/|ℹ/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

// Normalized text for Matching logic (Lower Cased)
function normalize(str) {
	return normalizeKeepCase(str).toLowerCase();
}

let voiceOptionsPanelResizeHandler = null;
let closePanelOnClickOutsideHandler = null;

function toggleVoiceOptionsPanel() {
	const toolbar = document.getElementById("extension-toolbar");
	if (!toolbar) return;

	const existing = toolbar.querySelector("#voice-options-panel");
	if (existing) {
		existing.remove();
		if (voiceOptionsPanelResizeHandler) {
			window.removeEventListener("message", voiceOptionsPanelResizeHandler);
			voiceOptionsPanelResizeHandler = null;
		}
		if (closePanelOnClickOutsideHandler) {
			document.removeEventListener('click', closePanelOnClickOutsideHandler);
			closePanelOnClickOutsideHandler = null;
		}
		return;
	}

	const panel = document.createElement("iframe");
	panel.id = "voice-options-panel";
	panel.src = chrome.runtime.getURL("popup.html");
	Object.assign(panel.style, {
		position: "absolute",
		top: "40px",
		right: "10px",
		minWidth: "300px",
		border: "1px solid #ccc",
		boxShadow: "0 2px 8px rgb(56, 54, 54)",
		zIndex: 10001,
		background: "white",
		transition: "height 0.2s ease-in-out, width 0.2s ease-in-out"
	});

	voiceOptionsPanelResizeHandler = (event) => {
		if (event.source !== panel.contentWindow) return;
		if (event.data && event.data.type === 'resize-voice-options-panel') {
			if (typeof event.data.height === 'number') {
				panel.style.height = `${event.data.height}px`;
			}
			if (typeof event.data.width === 'number') {
				panel.style.width = `${event.data.width}px`;
			}
		}
	};
	window.addEventListener("message", voiceOptionsPanelResizeHandler);

	toolbar.appendChild(panel);

	closePanelOnClickOutsideHandler = (event) => {
		const currentToolbar = document.getElementById("extension-toolbar");
		const currentPanel = document.getElementById("voice-options-panel");

		if (currentToolbar && currentPanel && !currentToolbar.contains(event.target)) {
			toggleVoiceOptionsPanel();
		}
	};

	setTimeout(() => {
		document.addEventListener('click', closePanelOnClickOutsideHandler);
	}, 0);
}

let lastHighlightedElement = null;
let lastHighlightedSpan = null;
let currentWordHighlightSpan = null;

let currentBlockWordMap = [];
let lastHighlightedWordIndex = -1;

let readableBlocks = [];
let readableSentences = [];
let currentBlockIndex = -1;
let currentSentenceIndex = -1;
let currentNavigationMode = "block";

function buildWordMap(dirtyText, cleanText) {
    const map = [];
    let dirtyPtr = 0;
    let cleanPtr = 0;

    while (cleanPtr < cleanText.length) {
        if (/\s/.test(cleanText[cleanPtr])) {
            cleanPtr++;
            continue;
        }

        const wordStartClean = cleanPtr; 
        while (cleanPtr < cleanText.length && !/\s/.test(cleanText[cleanPtr])) {
            cleanPtr++;
        }
        const wordEndClean = cleanPtr;
        const currentCleanWord = cleanText.substring(wordStartClean, wordEndClean);

        let alignPtr = 0;
        let wordStartDirty = -1;
        while (dirtyPtr < dirtyText.length && alignPtr < currentCleanWord.length) {
            const dirtyCharLower = dirtyText[dirtyPtr].toLowerCase();
            const cleanChar = currentCleanWord[alignPtr];

            // Case-insensitive comparison allows us to map mixed-case cleanText to dirtyText
            if (dirtyCharLower === cleanChar.toLowerCase()) {
                if (wordStartDirty === -1) {
                    wordStartDirty = dirtyPtr;
                }
                alignPtr++;
            } else if (wordStartDirty !== -1) {
                // Mismatch after start - normally reset, but greedy matching usually works for simple text
            }
            dirtyPtr++;
        }
        
        if (alignPtr === currentCleanWord.length) {
            map.push({
                text: currentCleanWord,
                startIndex: wordStartDirty,
                endIndex: dirtyPtr,
                cleanIndex: wordStartClean 
            });
        } else {
            console.warn(`Read Aloud: Could not fully align word "${currentCleanWord}". Highlighting may be affected.`);
        }
    }
    return map;
}

function splitIntoSentences(text) {
    // Use Intl.Segmenter for robust, locale-aware sentence splitting (handles U.S., Dr., etc.)
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
        return Array.from(segmenter.segment(text)).map(s => s.segment.trim()).filter(s => s.length > 0);
    }
    
    // Fallback if Intl is not available (rare in modern Chrome)
    const sentences = text.match(/(?:[^.!?]|\.(?=\w))+[.!?]*['"”’)\}\]]*(\s+|$)/g) || [text];
    return sentences.map(s => s.trim()).filter(s => s.length > 0);
}

async function loadNavigationMode() {
    try {
        const stored = await chrome.storage.sync.get({ navigationMode: "block" });
        currentNavigationMode = stored.navigationMode;
    } catch (error) {
        currentNavigationMode = "block";
    }
}

function extractReadableBlocks() {
	readableBlocks = [];
	readableSentences = [];
	currentBlockIndex = -1;
	currentSentenceIndex = -1;

	const docClone = document.cloneNode(true);
	docClone.querySelectorAll("aside").forEach(asideEl => {
		const parent = asideEl.parentNode;
		if (!parent) return;
		while (asideEl.firstChild) {
			parent.insertBefore(asideEl.firstChild, asideEl);
		}
		parent.removeChild(asideEl);
	});
	const article = new Readability(docClone).parse();
	if (!article?.content) return;

	const frag = document.createElement("div");
	frag.innerHTML = article.content;

	const selector = "p, li, h1, h2, h3, h4, h5, h6";
	const fragBlocks = Array.from(frag.querySelectorAll(selector));
	const liveBlocks = Array.from(document.querySelectorAll(selector));

	let liveIdx = 0;
	for (const fragEl of fragBlocks) {
		const text = fragEl.textContent.trim();
		if (!text) continue;

		for (let i = liveIdx; i < liveBlocks.length; i++) {
			const liveEl = liveBlocks[i];
            const dirtyText = liveEl.textContent;
            
            // Normalize with lowercase for flexible matching
            const cleanTextForComparison = normalize(dirtyText);
            const fragCleanText = normalize(text);

			if (liveEl.tagName === fragEl.tagName && cleanTextForComparison === fragCleanText) {

                // Use normalizeKeepCase for the actual TTS text to preserve "U.S." casing for Segmenter
                const cleanText = normalizeKeepCase(dirtyText);
                const wordMap = buildWordMap(dirtyText, cleanText);

				const blockEntry = {
					text: cleanText,
					element: liveEl,
                    wordMap: wordMap
				};
				readableBlocks.push(blockEntry);
                const blockIdx = readableBlocks.length - 1;

                let wordMapCursor = 0;
				const sentences = splitIntoSentences(cleanText);

				sentences.forEach((sentenceText, sentenceIdx) => {
                    const sentenceWordCount = (sentenceText.match(/\S+/g) || []).length;
                    const wordMapSlice = wordMap.slice(wordMapCursor, wordMapCursor + sentenceWordCount);

                    let adjustedWordMapSlice = wordMapSlice;
                    if (wordMapSlice.length > 0) {
                        const baseClean = wordMapSlice[0].cleanIndex;
                        adjustedWordMapSlice = wordMapSlice.map(w => ({
                            ...w,
                            localCleanIndex: w.cleanIndex - baseClean
                        }));
                    }

					readableSentences.push({
						text: sentenceText,
						element: liveEl,
						blockIndex: blockIdx,
						sentenceIndex: sentenceIdx,
                        wordMap: adjustedWordMapSlice
					});
                    wordMapCursor += sentenceWordCount;
				});

				liveIdx = i + 1;
				break;
			}
		}
	}
}

async function getFirstBlock() {
	if (readableBlocks.length === 0) extractReadableBlocks();
	await loadNavigationMode();
	
	if (currentNavigationMode === "sentence") {
		currentSentenceIndex = 0;
        const sentence = readableSentences[0];
		currentBlockIndex = sentence?.blockIndex ?? -1;
		return sentence?.text || "";
	} else {
		currentBlockIndex = 0;
		currentSentenceIndex = -1;
		return readableBlocks[0]?.text || "";
	}
}

async function getNextBlock() {
	await loadNavigationMode();
	
	if (currentNavigationMode === "sentence") {
		if (currentSentenceIndex < readableSentences.length - 1) {
			currentSentenceIndex++;
		}
        const sentence = readableSentences[currentSentenceIndex];
		currentBlockIndex = sentence?.blockIndex ?? currentBlockIndex;
		return sentence?.text || "";
	} else {
		if (currentBlockIndex < readableBlocks.length - 1) {
			currentBlockIndex++;
		}
		currentSentenceIndex = -1;
		return readableBlocks[currentBlockIndex]?.text || "";
	}
}

async function getPreviousBlock() {
	await loadNavigationMode();
	
	if (currentNavigationMode === "sentence") {
		if (currentSentenceIndex > 0) {
			currentSentenceIndex--;
		}
        const sentence = readableSentences[currentSentenceIndex];
		currentBlockIndex = sentence?.blockIndex ?? currentBlockIndex;
		return sentence?.text || "";
	} else {
		if (currentBlockIndex > 0) {
			currentBlockIndex--;
		}
		currentSentenceIndex = -1;
		return readableBlocks[currentBlockIndex]?.text || "";
	}
}

function getCurrentBlock() {
    if (readableBlocks.length === 0) extractReadableBlocks();
    
    if (currentNavigationMode === "sentence" && currentSentenceIndex !== -1) {
        const sentence = readableSentences[currentSentenceIndex];
        return sentence?.text || "";
    } else if (currentBlockIndex !== -1) {
        return readableBlocks[currentBlockIndex]?.text || "";
    }
    return "";
}

async function peekNextBlockText() {
    await loadNavigationMode();
    if (currentNavigationMode === "sentence") {
        if (currentSentenceIndex < readableSentences.length - 1) {
            return readableSentences[currentSentenceIndex + 1]?.text || null;
        }
    } else {
        if (currentBlockIndex < readableBlocks.length - 1) {
            return readableBlocks[currentBlockIndex + 1]?.text || null;
        }
    }
    return null;
}

function clearWordHighlight() {
    if (currentWordHighlightSpan) {
        const parent = currentWordHighlightSpan.parentNode;
        if (parent) {
            while (currentWordHighlightSpan.firstChild) {
                parent.insertBefore(currentWordHighlightSpan.firstChild, currentWordHighlightSpan);
            }
            parent.removeChild(currentWordHighlightSpan);
            parent.normalize();
        }
        currentWordHighlightSpan = null;
    }
}

function clearHighlight() {
    clearWordHighlight();

    currentBlockWordMap = [];
    lastHighlightedWordIndex = -1;

	if (lastHighlightedElement) {
		lastHighlightedElement.classList.remove("readAloudHighlight");
		lastHighlightedElement = null;
	}
	
	if (lastHighlightedSpan) {
		const parent = lastHighlightedSpan.parentNode;
		if (parent) {
			while (lastHighlightedSpan.firstChild) {
				parent.insertBefore(lastHighlightedSpan.firstChild, lastHighlightedSpan);
			}
			parent.removeChild(lastHighlightedSpan);
			parent.normalize();
		}
		lastHighlightedSpan = null;
	}
}

// === NEW HELPER FUNCTION: Find scrollable parent ===
function getScrollParent(node) {
    if (!node) return null;
    let parent = node.parentElement;
    
    // Stop at document.body/html, we treat those as "window"
    while (parent && parent !== document.body && parent !== document.documentElement) {
        const style = window.getComputedStyle(parent);
        const overflowY = style.overflowY;
        const isScrollable = overflowY !== 'visible' && overflowY !== 'hidden';
        
        // Ensure it actually has scrollable content
        if (isScrollable && parent.scrollHeight > parent.clientHeight) {
            return parent;
        }
        parent = parent.parentElement;
    }
    return null;
}

function highlightCurrentBlock() {
	clearHighlight();

	let elementToScrollTo = null;
    let currentUnit = null;

    if (currentNavigationMode === "sentence" && currentSentenceIndex !== -1) {
        currentUnit = readableSentences[currentSentenceIndex];
    } else if (currentBlockIndex !== -1) {
        currentUnit = readableBlocks[currentBlockIndex];
    }

    if (!currentUnit) return;

    currentBlockWordMap = currentUnit.wordMap;

	if (currentNavigationMode === "sentence" && currentSentenceIndex >= 0) {
		const sentenceEntry = readableSentences[currentSentenceIndex];
		if (sentenceEntry) {
			const element = sentenceEntry.element;
			
            const sentenceMap = sentenceEntry.wordMap;
            if (!sentenceMap || sentenceMap.length === 0) {
                element.classList.add("readAloudHighlight");
				lastHighlightedElement = element;
				elementToScrollTo = element;
            } else {
                const startOffset = sentenceMap[0].startIndex;
                const endOffset = sentenceMap[sentenceMap.length - 1].endIndex;
                const range = createRangeFromOffsets(element, startOffset, endOffset);
                
                if (range) {
                    try {
                        const span = document.createElement('span');
						span.className = 'readAloudHighlight';
						range.surroundContents(span);
						lastHighlightedSpan = span;
						elementToScrollTo = span;
                    } catch (e) {
                        element.classList.add("readAloudHighlight");
                        lastHighlightedElement = element;
                        elementToScrollTo = element;
                    }
                } else {
                    element.classList.add("readAloudHighlight");
                    lastHighlightedElement = element;
                    elementToScrollTo = element;
                }
            }
		}
	} else if (currentBlockIndex >= 0) {
		const blockEntry = readableBlocks[currentBlockIndex];
		if (blockEntry) {
			blockEntry.element.classList.add("readAloudHighlight");
			lastHighlightedElement = blockEntry.element;
			elementToScrollTo = blockEntry.element;
		}
	}

	if (elementToScrollTo) {
		const rect = elementToScrollTo.getBoundingClientRect();
		const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        
        const triggerY = viewportHeight * (readingAreaBottom / 100);
        const targetY = viewportHeight * (readingAreaTop / 100);

        // Check if element is outside the "Reading Area"
		if (rect.top > triggerY || rect.bottom < 0) {
            
            // === MODIFIED SCROLL LOGIC ===
            const scrollParent = getScrollParent(elementToScrollTo);
            
            if (scrollParent) {
                // If nested in a scrollable div (like on Android Developer site)
                const currentScrollTop = scrollParent.scrollTop;
                // Calculate new position: currentScroll + offset from top - desired top position
                const targetScrollPosition = currentScrollTop + rect.top - targetY;

                scrollParent.scrollTo({
                    top: targetScrollPosition,
                    behavior: 'smooth'
                });
            } else {
                // Standard Window scrolling
                const targetScrollPosition = window.scrollY + rect.top - targetY;
                window.scrollTo({
                    top: targetScrollPosition,
                    behavior: 'smooth'
                });
            }
            // =============================
		}
	}
}

async function getBlockContainingSelection(selectionText) {
	if (readableBlocks.length === 0) extractReadableBlocks();
	await loadNavigationMode();

	const sel = window.getSelection();
    // Use normalizeKeepCase to preserve text structure
	if (!sel || sel.isCollapsed) return normalizeKeepCase(selectionText);

	let node = sel.anchorNode;
	let element = (node.nodeType === Node.ELEMENT_NODE) ? node : node.parentElement;

	while (element) {
		const blockIdx = readableBlocks.findIndex(entry => entry.element === element);
		if (blockIdx !== -1) {
			if (currentNavigationMode === "sentence") {
				const container = readableBlocks[blockIdx].element;
				const sentencesInBlock = readableSentences.filter(s => s.blockIndex === blockIdx);
				let targetSentence = null;

				try {
					const selectionRange = sel.getRangeAt(0);

					targetSentence = sentencesInBlock.find(sentence => {
						const sentenceMap = sentence.wordMap;
						if (!sentenceMap || sentenceMap.length === 0) return false;

						const startOffset = sentenceMap[0].startIndex;
						const endOffset = sentenceMap[sentenceMap.length - 1].endIndex;
						const sentenceRange = createRangeFromOffsets(container, startOffset, endOffset);

						if (sentenceRange) {
							const isAfterStart = selectionRange.compareBoundaryPoints(Range.START_TO_START, sentenceRange) >= 0;
							const isBeforeEnd = selectionRange.compareBoundaryPoints(Range.END_TO_END, sentenceRange) <= 0;
							return isAfterStart && isBeforeEnd;
						}
						return false;
					});
				} catch (e) {
					targetSentence = null;
				}

				if (targetSentence) {
					currentSentenceIndex = readableSentences.indexOf(targetSentence);
					currentBlockIndex = blockIdx;
					return targetSentence.text;
				}

				const firstSentenceIdx = readableSentences.findIndex(entry => entry.blockIndex === blockIdx);
				if (firstSentenceIdx !== -1) {
					currentSentenceIndex = firstSentenceIdx;
					currentBlockIndex = blockIdx;
					return readableSentences[firstSentenceIdx].text;
				}
			} else {
				currentBlockIndex = blockIdx;
				currentSentenceIndex = -1;
				return readableBlocks[blockIdx].text;
			}
		}
		element = element.parentElement;
	}

    const cleanSel = normalizeKeepCase(sel.toString());
    currentBlockWordMap = buildWordMap(sel.toString(), cleanSel);
	return cleanSel;
}

function createRangeFromOffsets(container, startOffset, endOffset) {
    if (startOffset < 0 || endOffset < startOffset) return null;

    const range = document.createRange();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    let currentPos = 0;
    let startNode = null, rangeStartOffset = 0, endNode = null, rangeEndOffset = 0;
    let textNode;

    while ((textNode = walker.nextNode())) {
        const nodeLength = textNode.textContent.length;
        const nodeEnd = currentPos + nodeLength;

        if (!startNode && nodeEnd >= startOffset) {
            startNode = textNode;
            rangeStartOffset = startOffset - currentPos;
        }
        if (!endNode && nodeEnd >= endOffset) {
            endNode = textNode;
            rangeEndOffset = endOffset - currentPos;
            break;
        }
        currentPos = nodeEnd;
    }

    if (startNode && endNode) {
        try {
            range.setStart(startNode, rangeStartOffset);
            range.setEnd(endNode, rangeEndOffset);
            return range;
        } catch (e) {
            return null;
        }
    }
    return null;
}

function highlightWordByIndex(wordIndex) {
    clearWordHighlight();

    if (!currentBlockWordMap || wordIndex < 0 || wordIndex >= currentBlockWordMap.length) {
        return;
    }

    const wordMapEntry = currentBlockWordMap[wordIndex];
    if (!wordMapEntry) return;

    const highlightContainer = lastHighlightedSpan || lastHighlightedElement;
    if (!highlightContainer) return;

    let { startIndex, endIndex } = wordMapEntry;

    if (currentNavigationMode === 'sentence' && lastHighlightedSpan && currentBlockWordMap.length > 0) {
        const sentenceStartOffsetInBlock = currentBlockWordMap[0].startIndex;
        startIndex -= sentenceStartOffsetInBlock;
        endIndex -= sentenceStartOffsetInBlock;
    }

    const range = createRangeFromOffsets(highlightContainer, startIndex, endIndex);
    if (!range) {
        return;
    }

    try {
        const span = document.createElement('span');
        span.className = 'readAloudWordHighlight';
        const contents = range.extractContents();
        span.appendChild(contents);
        range.insertNode(span);
        currentWordHighlightSpan = span;
    } catch (e) {
        if (currentWordHighlightSpan) currentWordHighlightSpan.remove();
    }
}

let indicatorGIF = null;
let btnPlayPause = null;

function showIndicator(indicatorFlag) {
    if(indicatorGIF) indicatorGIF.style.backgroundColor = indicatorFlag ? "#00ff00" : "#cccccc";
}
function showPlayButton(showFlag) {
    if(btnPlayPause) btnPlayPause.textContent = showFlag ? "▶" : "⏸";
}

function createToolbar() {
	const toolbar = document.createElement("div");
	toolbar.id = "extension-toolbar";
	toolbar.style.position = "fixed";
	toolbar.style.top = "0";
	toolbar.style.left = "0";
	toolbar.style.width = "100%";
	toolbar.style.height = "40px";
	toolbar.style.display = "flex";
	toolbar.style.alignItems = "center";
	toolbar.style.justifyContent = "space-between";
	toolbar.style.padding = "0 10px";
	toolbar.style.borderBottom = "1px solid #ccc";
	toolbar.style.zIndex = "10000";
    toolbar.style.backgroundColor = "#ffffff";
    toolbar.style.boxShadow = "0 2px 5px rgba(0,0,0,0.2)";

	const containerIndicator = document.createElement("div");
	containerIndicator.style.display = "flex";
	containerIndicator.style.alignItems = "center";
	containerIndicator.style.gap = "10px";

	indicatorGIF = document.createElement("div");
	indicatorGIF.style.width = "12px";
	indicatorGIF.style.height = "12px";
    indicatorGIF.style.backgroundColor = "#cccccc";
    indicatorGIF.style.borderRadius = "50%";

	const indicatorHeader = document.createElement("span");
	indicatorHeader.textContent = "Read Aloud";
    indicatorHeader.style.fontWeight = "bold";
	indicatorHeader.style.color = "#333";

	const containerControls = document.createElement("div");
	containerControls.style.display = "flex";
	containerControls.style.alignItems = "center";
	containerControls.style.gap = "10px";

	const btnPrev = document.createElement("button");
	btnPrev.textContent = "⏮";
    btnPrev.style.border = "none";
    btnPrev.style.background = "none";
    btnPrev.style.cursor = "pointer";
	btnPrev.style.fontSize = "18px";
	btnPrev.addEventListener("click", () => {
		chrome.runtime.sendMessage({ action: "prevButton" });
	});

	btnPlayPause = document.createElement("button");
	btnPlayPause.textContent = "⏸";
    btnPlayPause.style.border = "none";
    btnPlayPause.style.background = "none";
    btnPlayPause.style.cursor = "pointer";
	btnPlayPause.style.fontSize = "18px";
	btnPlayPause.addEventListener("click", () => {
		chrome.runtime.sendMessage({ action: "playButton" });
	});

	const btnNext = document.createElement("button");
	btnNext.textContent = "⏭";
    btnNext.style.border = "none";
    btnNext.style.background = "none";
    btnNext.style.cursor = "pointer";
	btnNext.style.fontSize = "18px";
	btnNext.addEventListener("click", () => {
		chrome.runtime.sendMessage({ action: "nextButton" });
	});

	const containerTTSOptions = document.createElement("div");
	containerTTSOptions.style.display = "flex";
	containerTTSOptions.style.alignItems = "center";
	containerTTSOptions.style.gap = "15px";

	const voiceOptionsButton = document.createElement("button");
	voiceOptionsButton.id = "voice-options-button";
	voiceOptionsButton.textContent = "⚙️";
    voiceOptionsButton.style.border = "none";
    voiceOptionsButton.style.background = "none";
	voiceOptionsButton.style.fontSize = "18px";
	voiceOptionsButton.style.cursor = "pointer";
	voiceOptionsButton.addEventListener("click", toggleVoiceOptionsPanel);

	const closeButton = document.createElement("button");
	closeButton.id = "close-toolbar-button";
	closeButton.textContent = "✕";
	closeButton.style.fontSize = "16px";
	closeButton.style.color = "#666";
	closeButton.style.background = "none";
	closeButton.style.border = "none";
	closeButton.style.cursor = "pointer";
	closeButton.addEventListener("click", () => {
		removeToolbar();
	});

	containerIndicator.appendChild(indicatorGIF);
	containerIndicator.appendChild(indicatorHeader);

	containerControls.appendChild(btnPrev);
	containerControls.appendChild(btnPlayPause);
	containerControls.appendChild(btnNext);

	containerTTSOptions.appendChild(voiceOptionsButton);
	containerTTSOptions.appendChild(closeButton);

	toolbar.appendChild(containerIndicator);
	toolbar.appendChild(containerControls);
	toolbar.appendChild(containerTTSOptions);

	document.body.appendChild(toolbar);
	document.body.style.paddingTop = "45px";
}

function removeToolbar() {
	const toolbar = document.getElementById("extension-toolbar");
	if (toolbar) {
		chrome.runtime.sendMessage({ action: "stopTTS" });
		clearHighlight();
		toolbar.remove();
		document.body.style.paddingTop = "";
	}
}

let editorLines = { top: null, bottom: null };
let isDragging = null;

function createEditorLine(type, percentage, label) {
    const line = document.createElement("div");
    line.className = "read-aloud-reading-line";
    line.id = `read-aloud-${type}-line`;
    line.style.top = `${percentage}%`;
    line.dataset.label = label;
    
    line.addEventListener("mousedown", (e) => {
        isDragging = type;
        e.preventDefault();
    });

    return line;
}

function toggleReadingAreaEditor() {
    if (editorLines.top) {
        return;
    }

    const topLine = createEditorLine("top", readingAreaTop, "Scroll Target");
    const bottomLine = createEditorLine("bottom", readingAreaBottom, "Trigger Point");

    document.body.appendChild(topLine);
    document.body.appendChild(bottomLine);
    
    editorLines.top = topLine;
    editorLines.bottom = bottomLine;

    window.addEventListener("mousemove", handleEditorDrag);
    window.addEventListener("mouseup", stopEditorDrag);
}

function handleEditorDrag(e) {
    if (!isDragging) return;

    const viewportHeight = window.innerHeight;
    let percentage = (e.clientY / viewportHeight) * 100;
    
    percentage = Math.max(0, Math.min(100, percentage));

    if (isDragging === "top") {
        readingAreaTop = percentage;
        editorLines.top.style.top = `${percentage}%`;
    } else if (isDragging === "bottom") {
        readingAreaBottom = percentage;
        editorLines.bottom.style.top = `${percentage}%`;
    }
}

function stopEditorDrag() {
    isDragging = null;
}

async function saveReadingArea() {
    if (editorLines.top) {
        editorLines.top.remove();
        editorLines.top = null;
    }
    if (editorLines.bottom) {
        editorLines.bottom.remove();
        editorLines.bottom = null;
    }

    window.removeEventListener("mousemove", handleEditorDrag);
    window.removeEventListener("mouseup", stopEditorDrag);

    await chrome.storage.sync.set({
        readingAreaTop: readingAreaTop,
        readingAreaBottom: readingAreaBottom
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	const toolbar = document.getElementById("extension-toolbar");
	switch (message.action) {
		case "open-toolbar":
			if (!toolbar) createToolbar();
			return;

		case "close-toolbar":
			if (toolbar) removeToolbar();
			else clearHighlight();
			return;

		case "getFirstBlock":
			getFirstBlock().then(text => {
				highlightCurrentBlock();
				sendResponse({ text });
			});
			return true;

		case "getNextBlock":
			getNextBlock().then(text => {
				highlightCurrentBlock();
				sendResponse({ text });
			});
			return true;

		case "getPreviousBlock":
			getPreviousBlock().then(text => {
				highlightCurrentBlock();
				sendResponse({ text });
			});
			return true;

		case "getCurrentBlock":
			const currentText = getCurrentBlock();
			highlightCurrentBlock();
			sendResponse({ text: currentText });
			return true;

		case "peekNextBlock":
			peekNextBlockText().then(text => {
				sendResponse({ text });
			});
			return true;

		case "getBlockContainingSelection":
			getBlockContainingSelection(message.selectionText || "").then(blockText => {
                highlightCurrentBlock();
				sendResponse({ text: blockText });
			});
			return true;
        
        case "startBlockPlayback":
            clearWordHighlight();
            lastHighlightedWordIndex = -1;
            return;

        case "highlightWord":
            const charIndex = message.charIndex;
            if (currentBlockWordMap.length > 0) {
                const wordIndex = currentBlockWordMap.findIndex(w => 
                    charIndex >= (w.localCleanIndex ?? w.cleanIndex) && 
                    charIndex < ((w.localCleanIndex ?? w.cleanIndex) + w.text.length + 1)
                );

                if (wordIndex !== -1 && wordIndex !== lastHighlightedWordIndex) {
                    lastHighlightedWordIndex = wordIndex;
                    highlightWordByIndex(wordIndex);
                }
            }
            return;

		case "updateUiState":
			const state = message.state;
			if (toolbar && state) {
				if (state.runningTTS) {
					showIndicator(!state.isPaused);
					showPlayButton(state.isPaused);
				} else {
					showIndicator(false);
					showPlayButton(true);
				}
			}
			return;
            
        case "enableReadingAreaEditor":
            toggleReadingAreaEditor();
            return;

        case "saveReadingAreaEditor":
            saveReadingArea();
            return;
            
        case "getIndices":
            sendResponse({ currentBlockIndex, currentSentenceIndex });
            return;
            
        case "setIndices":
            if (readableBlocks.length === 0) extractReadableBlocks();
            currentBlockIndex = message.currentBlockIndex ?? currentBlockIndex;
            currentSentenceIndex = message.currentSentenceIndex ?? currentSentenceIndex;
            highlightCurrentBlock();
            sendResponse({ success: true });
            return;
            
        case "findBlockByExactText":
            const text = message.text;
            if (!text) {
                sendResponse({ found: false });
                return;
            }
            if (readableBlocks.length === 0) extractReadableBlocks();
            // Search in blocks first
            let foundIdx = readableBlocks.findIndex(block => block.text === text);
            if (foundIdx !== -1) {
                currentBlockIndex = foundIdx;
                currentSentenceIndex = -1;
                highlightCurrentBlock();
                sendResponse({ found: true, blockIndex: foundIdx, sentenceIndex: -1 });
                return;
            }
            // Search in sentences
            let foundSentIdx = readableSentences.findIndex(sentence => sentence.text === text);
            if (foundSentIdx !== -1) {
                currentSentenceIndex = foundSentIdx;
                currentBlockIndex = readableSentences[foundSentIdx].blockIndex;
                highlightCurrentBlock();
                sendResponse({ found: true, blockIndex: currentBlockIndex, sentenceIndex: foundSentIdx });
                return;
            }
            sendResponse({ found: false });
            return;
	}
});

// Notify background that content script is ready
chrome.runtime.sendMessage({ action: "contentScriptReady" });