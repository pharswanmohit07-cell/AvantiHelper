const loadQuestionBtn = document.getElementById("loadQuestionBtn");
const generateBtn = document.getElementById("generateBtn");
const questionTextEl = document.getElementById("questionText");
const optionsListEl = document.getElementById("optionsList");
const answerResultEl = document.getElementById("answerResult");
const selectionStatusEl = document.getElementById("selectionStatus");

let currentTabId = null;
let currentQuestion = "";
let currentOptions = [];

function setStatus(message, isError = false) {
  selectionStatusEl.textContent = message;
  selectionStatusEl.style.color = isError ? "#a12c27" : "#53635e";
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id ?? null;
  return tab;
}

function renderQuestion(question, options) {
  currentQuestion = question || "";
  currentOptions = Array.isArray(options) ? options : [];
  questionTextEl.textContent = currentQuestion || "No question detected.";
  optionsListEl.replaceChildren();

  if (!currentOptions.length) {
    const item = document.createElement("li");
    item.textContent = "No options found.";
    optionsListEl.appendChild(item);
    return;
  }

  currentOptions.forEach((option) => {
    const item = document.createElement("li");
    item.textContent = option;
    optionsListEl.appendChild(item);
  });
}

async function loadQuestionFromPage() {
  try {
    const tab = await getCurrentTab();
    if (!tab || currentTabId === null) {
      questionTextEl.textContent = "No active tab detected.";
      setStatus("No active tab detected.", true);
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: "GET_QUESTION_STATE" }, (response) => {
      if (chrome.runtime.lastError) {
        questionTextEl.textContent = "Could not connect to this page. Refresh the page and try again.";
        renderQuestion("", []);
        setStatus("The page may not allow extension access.", true);
        return;
      }
      if (!response) {
        renderQuestion("", []);
        setStatus("No question found on this page.", true);
        return;
      }
      renderQuestion(response.question, response.options);
      setStatus(response.question ? "Question loaded." : "No question found on this page.", !response.question);
    });
  } catch (error) {
    questionTextEl.textContent = "Could not load the page state.";
    setStatus("Could not load the page state.", true);
    console.error(error);
  }
}

function generateAnswer() {
  if (!currentQuestion || !currentOptions.length) {
    answerResultEl.textContent = "Load a question with options first.";
    setStatus("No question loaded.", true);
    return;
  }

  generateBtn.disabled = true;
  answerResultEl.textContent = "Analyzing with Gemini...";
  setStatus("Generating a suggestion...");

  chrome.runtime.sendMessage({
    type: "GENERATE_ANSWER",
    question: currentQuestion,
    options: currentOptions,
    tabId: currentTabId
  }, (response) => {
    generateBtn.disabled = false;
    if (chrome.runtime.lastError || !response?.success) {
      const message = response?.error || "Gemini request failed.";
      answerResultEl.textContent = message;
      setStatus("Gemini request failed.", true);
      return;
    }

    const result = response.result;
    if (!result?.parsedFromGemini || !Number.isInteger(result.index)) {
      answerResultEl.textContent = result?.rawAnswer
        ? `Could not match Gemini's response to an option: ${result.rawAnswer}`
        : "Gemini did not return a matchable answer.";
      setStatus("No option was selected because the answer could not be matched.", true);
      return;
    }

    const answerIndex = result.index;
    const answerText = currentOptions[answerIndex];
    answerResultEl.textContent = `Suggested option ${answerIndex + 1}: ${answerText}`;
    if (!result.selectionSuccess) {
      setStatus(result.selectionError || "Gemini answered, but the page selection could not be confirmed.", true);
      return;
    }
    setStatus(`Status: Matches Gemini's suggestion | Selected: ${answerIndex + 1}. ${answerText}`);
  });
}

loadQuestionBtn.addEventListener("click", loadQuestionFromPage);
generateBtn.addEventListener("click", generateAnswer);

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "QUESTION_UPDATED" && message.tabId === currentTabId) {
    loadQuestionFromPage();
  }
});

getCurrentTab().then(() => loadQuestionFromPage());
