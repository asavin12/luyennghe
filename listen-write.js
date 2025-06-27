let currentNotes = [];
let currentIndex = 0;
let stats = { correct: 0, incorrect: 0 };
let wrongWords = [];
let mistakeLog = {};
let totalAttempts = 0;
let currentDeck = '';
const repeatToggle = document.getElementById('repeatToggle');
repeatToggle.checked = true;
let loopStartTime = 0;
let loopEndTime = 0;
let isLooping = false;
let isSeeking = false; // Cờ để nhận biết người dùng có đang tua không
let hintTimeout;
let blinkInterval;

document.getElementById('dictationInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('checkButton').click();
    }
});

async function loadDecks() {
    const deckSelect = document.getElementById('deckSelect');
    deckSelect.innerHTML = '<option value="">Nhấn Vào Đây!</option>';

    try {
        const response = await fetch('data/decks.json');
        if (!response.ok) {
            showError('Không thể tải danh sách bộ thẻ: ' + response.statusText);
            return;
        }
        const decks = await response.json();

        decks.forEach(deck => {
            const option = document.createElement('option');
            option.value = deck;
            option.textContent = deck;
            deckSelect.appendChild(option);
        });

        localStorage.setItem('decks', JSON.stringify(decks));
    } catch (error) {
        showError('Lỗi khi tải danh sách bộ thẻ: ' + error.message);
    }
}

document.getElementById('deckSelect').addEventListener('change', async (e) => {
    const deckName = e.target.value;
    if (!deckName) return;

    try {
        const notesResponse = await fetch(`data/${deckName}/notes.json`);
        if (!notesResponse.ok) {
            showError(`Không thể tải notes từ bộ thẻ ${deckName}: ${notesResponse.statusText}`);
            return;
        }
        const notes = await notesResponse.json();

        currentNotes = notes.filter(note => validateNote(note));
        if (currentNotes.length === 0) {
            showError('Không tìm thấy thẻ nào hợp lệ trong bộ này');
            return;
        }

        currentNotes = currentNotes.map(note => ({
            deck: deckName,
            fields: {
                sound: { value: `[sound:${note.sound}]` },
                transcription: { value: cleanText(note.transcription) },
                meaning: { value: note.meaning || '' }
            }
        }));

        currentNotes.sort((a, b) => {
            let soundA = a.fields.sound.value.match(/\[sound:(.*?)\]/);
            let soundB = b.fields.sound.value.match(/\[sound:(.*?)\]/);
            soundA = soundA ? soundA[1].toLowerCase() : '';
            soundB = soundB ? soundB[1].toLowerCase() : '';
            return soundA.localeCompare(soundB);
        });

        currentDeck = deckName;
        currentIndex = 0;
        wrongWords = [];
        mistakeLog = {};
        totalAttempts = 0;
        document.getElementById('jumpToInput').max = currentNotes.length; // Cập nhật giới hạn input
        document.getElementById('storyContainer').classList.remove('hidden');
        loadStory();
    } catch (error) {
        showError('Lỗi khi tải bộ thẻ: ' + error.message);
    }
});

document.getElementById('jumpToButton').addEventListener('click', () => {
    const jumpToInput = document.getElementById('jumpToInput');
    const sentenceNumber = parseInt(jumpToInput.value);

    if (isNaN(sentenceNumber) || sentenceNumber < 1 || sentenceNumber > currentNotes.length) {
        showError(`Vui lòng nhập số câu hợp lệ (1 đến ${currentNotes.length})`);
        jumpToInput.value = '';
        return;
    }

    currentIndex = sentenceNumber - 1;
    loadStory();
    jumpToInput.value = '';
});

function validateNote(note) {
    return note.sound && note.transcription;
}

function getAudioFilePath(soundField) {
    const fileName = soundField.value.match(/\[sound:(.*?)\]/)?.[1];
    if (!fileName) {
        showError('Không tìm thấy tên file âm thanh');
        return null;
    }
    return `data/${currentDeck}/${fileName}`;
}

function loadStory() {
    const note = currentNotes[currentIndex];
    const fields = note.fields;
    
    const audioPath = getAudioFilePath(fields.sound);
    if (!audioPath) return;
    
    const audioPlayer = document.getElementById('audioPlayer');
    audioPlayer.src = audioPath;
    audioPlayer.onloadedmetadata = () => {
        document.getElementById('duration').textContent = formatTime(audioPlayer.duration);
    };
    audioPlayer.play();

    document.getElementById('progressDisplay').textContent = `Câu: ${currentIndex + 1}/${currentNotes.length}`;

    document.getElementById('dictationInput').value = '';
    document.getElementById('highlight').innerHTML = '';
    document.getElementById('feedback').innerHTML = '';
    document.getElementById('translation').classList.add('hidden');
    loopStartTime = 0;
    loopEndTime = 0;
    isLooping = false;
    
    const playLoopButton = document.getElementById('playLoopButton');
    playLoopButton.textContent = 'Phát đoạn lặp';
    playLoopButton.style.backgroundColor = '#4CAF50';


    document.getElementById('dictationInput').addEventListener('input', updateHighlight);
    updateWrongWordsStats();
    updateStats();
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.floor((seconds % 1) * 1000);
    return `${minutes}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

function cleanText(text) {
    return text
        .normalize("NFC")
        .replace(/\s+/g, ' ')
        .replace(/[\u200B\u00A0]/g, '')
        .trim();
}

function removePunctuation(text) {
    return text.replace(/[.,?!;:]/g, '');
}

function updateHighlight() {
    let userText = document.getElementById('dictationInput').value;
    document.getElementById('highlight').innerHTML = userText;

    const dictationInput = document.getElementById('dictationInput');
    const highlight = document.getElementById('highlight');
    const inputStyle = window.getComputedStyle(dictationInput);

    highlight.style.fontSize = inputStyle.fontSize;
    highlight.style.lineHeight = inputStyle.lineHeight;
    highlight.style.fontFamily = inputStyle.fontFamily;
    highlight.style.fontWeight = inputStyle.fontWeight;
    highlight.style.fontStyle = inputStyle.fontStyle;
    highlight.style.letterSpacing = inputStyle.letterSpacing;
    highlight.style.wordSpacing = inputStyle.wordSpacing;
    highlight.style.padding = inputStyle.padding;
    highlight.style.border = inputStyle.border;
    highlight.style.backgroundColor = "transparent";
    highlight.style.width = dictationInput.offsetWidth + 'px';
    highlight.style.height = dictationInput.offsetHeight + 'px';
}

document.getElementById('checkButton').addEventListener('click', () => {
    const dictationInput = document.getElementById('dictationInput');
    const userText = dictationInput.value.trim();
    const correctText = currentNotes[currentIndex].fields.transcription.value.trim();
    
    const userTextNoPunct = removePunctuation(userText);
    const correctTextNoPunct = removePunctuation(correctText);
    
    const userWords = userTextNoPunct.split(/\s+/);
    const correctWords = correctTextNoPunct.split(/\s+/);
    
    let firstErrorIndex = -1;
    for (let i = 0; i < Math.max(userWords.length, correctWords.length); i++) {
        if ((userWords[i] || "").toLowerCase() !== (correctWords[i] || "").toLowerCase()) {
            firstErrorIndex = i;
            break;
        }
    }
    
    const feedback = document.getElementById('feedback');
    const highlight = document.getElementById('highlight');
    const originalUserWords = userText.split(/\s+/);
    const originalCorrectWords = correctText.split(/\s+/);

    totalAttempts++;
    if (userText.trim() === '') {
        firstErrorIndex = 0; 
    }
    
    if (firstErrorIndex >= 0) {
        let highlightHTML = '';
        const userWord = originalUserWords[firstErrorIndex] || '';
        const correctWordForHint = originalCorrectWords[firstErrorIndex] || '';

        for (let i = 0; i < originalUserWords.length; i++) {
            if (i === firstErrorIndex) {
                highlightHTML += `<span class="incorrect-word-hint"><span class="user-word">${userWord}</span> → <span class="correct-word-suggestion">${correctWordForHint}</span></span>`;
            } else {
                highlightHTML += originalUserWords[i];
            }
            if (i < originalUserWords.length - 1) highlightHTML += ' ';
        }
        
        highlight.innerHTML = highlightHTML;

        wrongWords.push({
            wrong: userWord,
            correct: correctWordForHint
        });

        const correctWordForStats = originalCorrectWords[firstErrorIndex] || '';
        mistakeLog[correctWordForStats] = (mistakeLog[correctWordForStats] || 0) + 1;

        feedback.innerHTML = ''; 
        stats.incorrect++;

        const wordsBeforeError = originalUserWords.slice(0, firstErrorIndex).join(' ');
        const cursorPosition = wordsBeforeError.length + (wordsBeforeError.length > 0 ? 1 : 0);
        dictationInput.focus();
        const incorrectWordLength = userWord.length;
        dictationInput.setSelectionRange(cursorPosition, cursorPosition + incorrectWordLength);
        dictationInput.scrollTop = dictationInput.scrollHeight;

    } else {
        feedback.innerHTML = '<div class="correct">Chính xác!</div>';
        highlight.innerHTML = userText;
        stats.correct++;
        setTimeout(nextStory, 1000);
    }
    
    updateStats();
    updateWrongWordsStats();
});

document.getElementById('translateButton').addEventListener('click', () => {
    const translation = currentNotes[currentIndex].fields.meaning.value;
    const translationDiv = document.getElementById('translation');
    translationDiv.innerHTML = `<strong>Bản dịch:</strong> ${translation || 'Không có bản dịch'}`;
    translationDiv.classList.remove('hidden');
});

document.getElementById('skipButton').addEventListener('click', () => {
    nextStory();
});

document.getElementById('prevButton').addEventListener('click', () => {
    prevStory();
});

function nextStory() {
    if (currentIndex + 1 >= currentNotes.length) {
        showCompletionMessage();
        return;
    }
    currentIndex++;
    loadStory();
}

function prevStory() {
    if (currentIndex - 1 < 0) {
        alert('Đây đã là câu đầu tiên!');
        return;
    }
    currentIndex--;
    loadStory();
}

function showCompletionMessage() {
    document.getElementById('completionMessage').style.display = 'block';
    document.getElementById('checkButton').style.display = 'none';
    document.getElementById('skipButton').style.display = 'none';
    document.getElementById('translateButton').style.display = 'none';
    document.getElementById('prevButton').style.display = 'none';
    document.getElementById('reloadButton').style.display = 'block';
}

document.getElementById('reloadButton').addEventListener('click', () => {
    location.reload();
});

function updateStats() {
    document.getElementById('correctCount').textContent = stats.correct;
    document.getElementById('incorrectCount').textContent = stats.incorrect;

    const mistakeList = document.getElementById('mistakeList');
    mistakeList.innerHTML = '';
    const mistakeStats = document.getElementById('mistakeStats');

    if (Object.keys(mistakeLog).length > 0) {
        mistakeStats.classList.remove('hidden');
        const sortedMistakes = Object.entries(mistakeLog)
            .sort((a, b) => b[1] - a[1]);

        sortedMistakes.forEach(([word, count]) => {
            const percentage = ((count / totalAttempts) * 100).toFixed(1);
            const li = document.createElement('li');
            li.innerHTML = `
                <span class="word">"${word}"</span>
                <span class="stats">${count} lần (${percentage}%)</span>
            `;
            mistakeList.appendChild(li);
        });
    } else {
        mistakeStats.classList.add('hidden');
    }
}

function updateWrongWordsStats() {
    const wrongWordsList = document.getElementById('wrongWordsList');
    wrongWordsList.innerHTML = '';
    wrongWords.forEach(word => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="incorrect-word">${word.wrong}</span> → <span class="correct-word">${word.correct}</span>`;
        wrongWordsList.appendChild(li);
    });
}

function showError(message) {
    console.error(message);
    document.getElementById('errorMessage').textContent = message;
    setTimeout(() => document.getElementById('errorMessage').textContent = '', 5000);
}

document.getElementById('startLoopButton').addEventListener('click', () => {
    const audioPlayer = document.getElementById('audioPlayer');
    loopStartTime = audioPlayer.currentTime;
});

document.getElementById('endLoopButton').addEventListener('click', () => {
    const audioPlayer = document.getElementById('audioPlayer');
    loopEndTime = audioPlayer.currentTime;
});

document.getElementById('playLoopButton').addEventListener('click', () => {
    const audioPlayer = document.getElementById('audioPlayer');
    const playLoopButton = document.getElementById('playLoopButton');

    if (loopStartTime >= loopEndTime) {
        alert('Vui lòng đặt điểm lặp hợp lệ');
        return;
    }

    isLooping = !isLooping;

    if (isLooping) {
        audioPlayer.currentTime = loopStartTime;
        audioPlayer.play();
        playLoopButton.textContent = 'Dừng lặp';
        playLoopButton.style.backgroundColor = '#f44336';
    } else {
        playLoopButton.textContent = 'Phát đoạn lặp';
        playLoopButton.style.backgroundColor = '#4CAF50';
    }
});

document.getElementById('audioPlayer').loop = true;

repeatToggle.addEventListener('change', function() {
    document.getElementById('audioPlayer').loop = this.checked;
});

document.getElementById('clearLoopButton').addEventListener('click', () => {
    const audioPlayer = document.getElementById('audioPlayer');
    const playLoopButton = document.getElementById('playLoopButton');
    
    loopStartTime = 0;
    loopEndTime = 0;
    isLooping = false;
    
    audioPlayer.pause();
    audioPlayer.currentTime = 0;

    playLoopButton.textContent = 'Phát đoạn lặp';
    playLoopButton.style.backgroundColor = '#4CAF50';
});

function startHintTimer() {
    clearTimeout(hintTimeout);
    hintTimeout = setTimeout(showHint, 3000);
}

function showHint() {
    let inputField = document.getElementById('dictationInput');
    let highlight = document.getElementById('highlight');
    let userText = inputField.value;
    let correctText = currentNotes[currentIndex].fields.transcription.value;

    if (userText.length >= correctText.length) return;

    let nextChar = correctText[userText.length];
    let oldHint = document.querySelector('.hint-char');
    if (oldHint) oldHint.remove();

    inputField.setAttribute('data-placeholder', inputField.getAttribute('placeholder'));
    inputField.setAttribute('placeholder', '');

    let cursorPos = inputField.selectionStart;
    let beforeCursor = userText.substring(0, cursorPos);
    let afterCursor = userText.substring(cursorPos);

    highlight.innerHTML = '';
    highlight.textContent = beforeCursor;

    let hintSpan = document.createElement('span');
    hintSpan.classList.add('hint-char');
    hintSpan.textContent = nextChar;
    hintSpan.style.opacity = '0.5';

    highlight.appendChild(hintSpan);
    highlight.appendChild(document.createTextNode(afterCursor));

    clearInterval(blinkInterval);
    blinkInterval = setInterval(() => {
        hintSpan.style.opacity = (hintSpan.style.opacity === '0.5') ? '0' : '0.5';
    }, 500);
}

document.getElementById('dictationInput').addEventListener('input', () => {
    clearTimeout(hintTimeout);
    clearInterval(blinkInterval);

    let oldHint = document.querySelector('.hint-char');
    if (oldHint) oldHint.remove();

    startHintTimer();
});

document.addEventListener("DOMContentLoaded", function () {
    loadDecks();

    const audioPlayer = document.getElementById('audioPlayer');

    // Lắng nghe sự kiện 'seeking' để biết người dùng đang tua
    audioPlayer.addEventListener('seeking', () => {
        isSeeking = true;
    });

    // Lắng nghe sự kiện 'seeked' để biết người dùng đã tua xong
    audioPlayer.addEventListener('seeked', () => {
        isSeeking = false;
    });
    
    audioPlayer.addEventListener('timeupdate', () => {
        // Cập nhật hiển thị thời gian hiện tại
        document.getElementById('currentTime').textContent = formatTime(audioPlayer.currentTime);

        // Không áp dụng logic lặp lại khi người dùng đang tua
        if (isSeeking) {
            return;
        }

        // Xử lý logic lặp lại
        if (isLooping && loopEndTime > 0 && audioPlayer.currentTime >= loopEndTime) {
            // Đặt lại thời gian về đầu đoạn lặp
            audioPlayer.currentTime = loopStartTime;
            // Gọi play() để đảm bảo audio tiếp tục phát ổn định trên các trình duyệt
            audioPlayer.play();
        }
    });
});