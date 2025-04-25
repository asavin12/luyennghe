let currentNotes = [];
let currentIndex = 0;
let stats = { correct: 0, incorrect: 0 };
let hiddenWords = [];
let mistakeLog = {};
let totalAttempts = 0;
let currentDeck = '';
const repeatToggle = document.getElementById('repeatToggle');
repeatToggle.checked = true;

// Danh sách từ loại tiếng Đức đơn giản (có thể mở rộng)
const verbs = []; // Ví dụ động từ
const nouns = []; // Ví dụ danh từ
const unimportantWords = ['und', 'oder', 'aber', 'mit', 'in', 'auf', 'zu', 'an', 'der', 'die', 'das', 'ein', 'eine'];

// Cập nhật giá trị tỷ lệ từ ẩn khi kéo thanh trượt
document.getElementById('hiddenRatio').addEventListener('input', function() {
    document.getElementById('hiddenRatioValue').textContent = `${this.value}%`;
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
        hiddenWords = [];
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

function selectHiddenWords(text) {
    const parts = text.match(/[^\w\säöüÄÖÜß]+|[\wäöüÄÖÜß]+|\s+/g) || [];
    const minHiddenWords = parseInt(document.getElementById('minHiddenWords').value);
    const hiddenRatio = parseInt(document.getElementById('hiddenRatio').value) / 100;

    const words = parts.map((part, index) => ({
        text: part,
        index: index,
        isWord: /^[\wäöüÄÖÜß]+$/.test(part)
    })).filter(item => item.isWord);

    let hideCount = Math.max(minHiddenWords, Math.floor(words.length * hiddenRatio));
    if (hideCount > words.length) hideCount = words.length;

    const taggedWords = words.map(word => {
        const lowerWord = word.text.toLowerCase();
        let type = 'other';
        if (verbs.includes(lowerWord)) type = 'verb';
        else if (nouns.some(n => lowerWord === n.toLowerCase())) type = 'noun';
        else if (unimportantWords.includes(lowerWord)) type = 'unimportant';
        return { ...word, type };
    });

    const indices = new Set();

    const verbsAndNouns = taggedWords.filter(w => w.type === 'verb' || w.type === 'noun');
    const shuffleVerbsAndNouns = verbsAndNouns.sort(() => 0.5 - Math.random());
    for (let i = 0; i < Math.min(hideCount, shuffleVerbsAndNouns.length); i++) {
        indices.add(shuffleVerbsAndNouns[i].index);
    }

    const others = taggedWords.filter(w => w.type !== 'unimportant' && !indices.has(w.index));
    const shuffleOthers = others.sort(() => 0.5 - Math.random());
    while (indices.size < hideCount && shuffleOthers.length > 0) {
        indices.add(shuffleOthers.shift().index);
    }

    while (indices.size < hideCount && indices.size < words.length) {
        const randomWord = taggedWords[Math.floor(Math.random() * taggedWords.length)];
        if (!indices.has(randomWord.index)) indices.add(randomWord.index);
    }

    hiddenWords = Array.from(indices).map(index => ({
        index,
        word: parts[index]
    }));

    return parts;
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
    updateAudioTime();
    audioPlayer.play();

    document.getElementById('progressDisplay').textContent = `Câu: ${currentIndex + 1}/${currentNotes.length}`;

    document.getElementById('feedback').innerHTML = '';
    document.getElementById('translation').classList.add('hidden');

    const textContainer = document.getElementById('textContainer');
    textContainer.innerHTML = '';
    const parts = selectHiddenWords(fields.transcription.value);
    
    let textContent = '';
    parts.forEach((part, index) => {
        const isHidden = hiddenWords.some(hw => hw.index === index);
        if (isHidden) {
            textContent += `<input type="text" data-index="${index}" style="width: ${Math.max(50, part.length * 13)}px">`;
        } else {
            if (/\s+/.test(part)) {
                textContent += part;
            } else {
                textContent += `<span>${part}</span>`;
            }
        }
    });

    textContainer.innerHTML = textContent;

    const inputs = textContainer.querySelectorAll('input');
    inputs.forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                checkInput(input);
            }
        });
    });

    const firstInput = document.querySelector('#textContainer input');
    if (firstInput) firstInput.focus();
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function updateAudioTime() {
    const audioPlayer = document.getElementById('audioPlayer');
    function updateTime() {
        document.getElementById('currentTime').textContent = formatTime(audioPlayer.currentTime);
        requestAnimationFrame(updateTime);
    }
    requestAnimationFrame(updateTime);
}

function cleanText(text) {
    return text
        .normalize("NFC")
        .replace(/\s+/g, ' ')
        .replace(/[\u200B\u00A0]/g, '')
        .trim();
}

function removePunctuation(text) {
    return text.replace(/[.,?!]/g, '');
}

function checkInput(input) {
    const inputs = Array.from(document.querySelectorAll('#textContainer input'));
    const filledInputs = inputs.filter(inp => inp.value.trim() !== '');
    const feedback = document.getElementById('feedback');
    let allFilledCorrect = true;
    let feedbackHTML = '';

    filledInputs.forEach(inp => {
        const index = parseInt(inp.dataset.index);
        const userAnswer = inp.value.trim();
        const correctWord = hiddenWords.find(hw => hw.index === index).word;

        const userAnswerNoPunct = removePunctuation(userAnswer);
        const correctWordNoPunct = removePunctuation(correctWord);

        totalAttempts++;
        if (userAnswerNoPunct === correctWordNoPunct) {
            inp.classList.add('correct-input');
            inp.classList.remove('incorrect-input');
        } else {
            inp.classList.add('incorrect-input');
            inp.classList.remove('correct-input');
            allFilledCorrect = false;
            mistakeLog[correctWord] = (mistakeLog[correctWord] || 0) + 1;
            feedbackHTML += `
                <div class="hint-item">
                    <span class="incorrect-word">${userAnswer}</span>
                    → <span class="correct-word">${correctWord}</span>
                </div>
            `;
        }
    });

    if (filledInputs.length === 0) {
        feedback.innerHTML = '';
        return;
    }

    const currentInputIndex = inputs.indexOf(input);
    const currentAnswer = input.value.trim();
    const currentCorrectWord = hiddenWords.find(hw => hw.index === parseInt(input.dataset.index)).word;
    const isCurrentCorrect = removePunctuation(currentAnswer) === removePunctuation(currentCorrectWord);

    if (isCurrentCorrect) {
        for (let i = currentInputIndex - 1; i >= 0; i--) {
            const prevInput = inputs[i];
            const prevAnswer = prevInput.value.trim();
            const prevCorrectWord = hiddenWords.find(hw => hw.index === parseInt(prevInput.dataset.index)).word;
            const isPrevCorrect = prevAnswer !== '' && removePunctuation(prevAnswer) === removePunctuation(prevCorrectWord);
            if (!isPrevCorrect) {
                prevInput.focus();
                const rect = prevInput.getBoundingClientRect();
                if (rect.top < 0 || rect.bottom > window.innerHeight) {
                    prevInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
                return;
            }
        }
        for (let i = currentInputIndex + 1; i < inputs.length; i++) {
            const nextInput = inputs[i];
            const nextAnswer = nextInput.value.trim();
            const nextCorrectWord = hiddenWords.find(hw => hw.index === parseInt(nextInput.dataset.index)).word;
            const isNextCorrect = nextAnswer !== '' && removePunctuation(nextAnswer) === removePunctuation(nextCorrectWord);
            if (!isNextCorrect) {
                nextInput.focus();
                const rect = nextInput.getBoundingClientRect();
                if (rect.top < 0 || rect.bottom > window.innerHeight) {
                    nextInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
                return;
            }
        }
    }

    if (allFilledCorrect && filledInputs.length === inputs.length) {
        feedback.innerHTML = '<div class="correct">Chính xác!</div>';
        stats.correct++;
        updateStats();

        const currentNote = currentNotes[currentIndex];
        const meaning = currentNote.fields.meaning ? currentNote.fields.meaning.value : 'Không có bản dịch';
        const translationDiv = document.getElementById('translation');
        translationDiv.innerHTML = `<strong>Bản dịch:</strong> ${meaning}`;
        translationDiv.classList.remove('hidden');

        setTimeout(() => {
            translationDiv.classList.add('hidden');
            nextStory();
        }, 3000);
    } else if (!allFilledCorrect) {
        feedback.innerHTML = `<div class="hint-container">${feedbackHTML}</div>`;
        stats.incorrect++;
        updateStats();
    } else {
        feedback.innerHTML = '';
    }
}

document.getElementById('checkButton').addEventListener('click', () => {
    const inputs = document.querySelectorAll('#textContainer input');
    let allCorrect = true;
    let feedbackHTML = '';

    inputs.forEach(input => {
        const index = parseInt(input.dataset.index);
        const userAnswer = input.value.trim();
        const correctWord = hiddenWords.find(hw => hw.index === index).word;

        if (userAnswer !== '') {
            totalAttempts++;
            const userAnswerNoPunct = removePunctuation(userAnswer);
            const correctWordNoPunct = removePunctuation(correctWord);

            if (userAnswerNoPunct === correctWordNoPunct) {
                input.classList.add('correct-input');
                input.classList.remove('incorrect-input');
            } else {
                input.classList.add('incorrect-input');
                input.classList.remove('correct-input');
                allCorrect = false;
                mistakeLog[correctWord] = (mistakeLog[correctWord] || 0) + 1;
                feedbackHTML += `
                    <div class="hint-item">
                        <span class="incorrect-word">${userAnswer}</span>
                        → <span class="correct-word">${correctWord}</span>
                    </div>
                `;
            }
        }
    });

    const feedback = document.getElementById('feedback');
    if (allCorrect && Array.from(inputs).every(inp => inp.value.trim() !== '')) {
        feedback.innerHTML = '<div class="correct">Chính xác!</div>';
        stats.correct++;
        updateStats();

        const currentNote = currentNotes[currentIndex];
        const meaning = currentNote.fields.meaning ? currentNote.fields.meaning.value : 'Không có bản dịch';
        const translationDiv = document.getElementById('translation');
        translationDiv.innerHTML = `<strong>Bản dịch:</strong> ${meaning}`;
        translationDiv.classList.remove('hidden');

        setTimeout(() => {
            translationDiv.classList.add('hidden');
            nextStory();
        }, 3000);
    } else if (feedbackHTML) {
        feedback.innerHTML = `<div class="hint-container">${feedbackHTML}</div>`;
        stats.incorrect++;
        updateStats();
    } else {
        feedback.innerHTML = '';
    }
});

document.getElementById('translateButton').addEventListener('click', () => {
    const note = currentNotes[currentIndex];
    const meaning = note.fields.meaning ? note.fields.meaning.value : 'Không có bản dịch';
    const translationDiv = document.getElementById('translation');
    translationDiv.innerHTML = `<strong>Bản dịch:</strong> ${meaning}`;
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
        alert('Đã hoàn thành tất cả câu!');
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

function showError(message) {
    document.getElementById('errorMessage').textContent = message;
    setTimeout(() => document.getElementById('errorMessage').textContent = '', 5000);
}

document.getElementById('audioPlayer').loop = true;

repeatToggle.addEventListener('change', function() {
    document.getElementById('audioPlayer').loop = this.checked;
});

document.addEventListener("DOMContentLoaded", function () {
    loadDecks();
});