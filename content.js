function findQuestionText() {
    const selectors = [
        "[data-testid='question']",
        ".mcq-question",
        ".quiz-question",
        ".question-text",
        ".question",
        ".ques"
    ];

    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent && element.textContent.trim()) {
            return element.textContent.trim();
        }
    }

    const bodyText = document.body?.innerText || "";
    const blocks = bodyText.split(/\n{2,}/).map((block) => block.trim()).filter((block) => block.length > 20);
    return blocks.find((block) => block.includes("?")) || blocks.sort((left, right) => right.length - left.length)[0] || "";
}

function mathText(mathNode) {
    const children = [...mathNode.children].map(mathText).join(" ");
    switch (mathNode.localName) {
        case "mi":
        case "mn":
        case "mtext":
        case "mo":
            return mathNode.textContent.trim();
        case "msup":
            return `${mathText(mathNode.children[0])}^(${mathText(mathNode.children[1])})`;
        case "msub":
            return `${mathText(mathNode.children[0])}_${mathText(mathNode.children[1])}`;
        case "msubsup":
            return `${mathText(mathNode.children[0])}_${mathText(mathNode.children[1])}^(${mathText(mathNode.children[2])})`;
        case "msqrt":
            return `sqrt(${children})`;
        case "mroot":
            return `${mathText(mathNode.children[0])} root ${mathText(mathNode.children[1])}`;
        case "mfrac":
            return `(${mathText(mathNode.children[0])})/(${mathText(mathNode.children[1])})`;
        case "mfenced":
            return `(${children})`;
        case "mspace":
            return "";
        default:
            return children;
    }
}

function readableText(element) {
    if (!element) return "";
    const readNode = (node) => {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent;
        if (node.nodeType !== Node.ELEMENT_NODE || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(node.tagName)) return "";
        if (node.matches("mjx-container")) {
            const math = node.querySelector("mjx-assistive-mml math");
            return math ? mathText(math) : (node.innerText || node.textContent || "");
        }
        if (node.tagName === "BR") return " ";
        const content = [...node.childNodes].map(readNode).join("");
        return ["P", "DIV", "LI"].includes(node.tagName) ? ` ${content} ` : content;
    };
    return [...element.childNodes]
        .map(readNode)
        .join("")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function visibleText(element) {
    return element && element.getClientRects().length > 0 ? readableText(element) : "";
}

function findAvantiQuestionData() {
    const questionElements = [...document.querySelectorAll('[data-test="text"]')]
        .filter((element) => visibleText(element));
    const candidates = [];

    for (const questionElement of questionElements) {
        let container = questionElement.parentElement;
        while (container && container !== document.body) {
            const optionNodes = [...container.querySelectorAll(
                '[data-test^="option-"]:not([data-test^="optionContainer-"])'
            )].filter((element) => visibleText(element));
            if (optionNodes.length) {
                candidates.push({ question: visibleText(questionElement), optionNodes });
                break;
            }
            container = container.parentElement;
        }
    }
    return candidates.sort((left, right) => {
        const score = (candidate) => candidate.question.length + (candidate.question.includes("?") ? 1000 : 0);
        return score(right) - score(left);
    })[0] || null;
}

function getNodeText(node) {
    if (!node) return "";
    if (node.tagName === "INPUT") {
        const label = node.closest("label") || (node.id && document.querySelector(`label[for="${CSS.escape(node.id)}"]`));
        return label ? readableText(label) : node.value?.trim() || "";
    }
    return readableText(node) || (node.value || "").trim();
}

function getGenericOptionElements() {
    const inputs = [...document.querySelectorAll("input[type='radio'], input[type='checkbox']")];
    const candidates = inputs.length
        ? inputs
        : [...document.querySelectorAll("[role='radio'], [role='checkbox'], label, .option, .answer, button, li")];

    const priority = (node) => {
        if (node.matches("[role='radio'], [role='checkbox']")) return 0;
        if (node.tagName === "LABEL") return 1;
        if (node.classList.contains("option") || node.classList.contains("answer")) return 2;
        if (node.tagName === "BUTTON") return 3;
        return 4;
    };
    candidates.sort((left, right) => priority(left) - priority(right));

    const seen = new Set();
    return candidates.filter((node) => {
        if (!inputs.length && node.getClientRects().length === 0) return false;
        const text = getNodeText(node);
        const key = text.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (text.length < 2 || !key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function getOptionElements() {
    return findAvantiQuestionData()?.optionNodes || getGenericOptionElements();
}

function getQuestionState() {
    const avantiData = findAvantiQuestionData();
    const question = avantiData?.question || findQuestionText();
    const optionNodes = avantiData?.optionNodes || getGenericOptionElements();
    const options = optionNodes.map(getNodeText);
    const selectedIndex = optionNodes.findIndex((node) => {
        if (node.tagName === "INPUT") return node.checked;
        return node.getAttribute("aria-checked") === "true"
            || node.getAttribute("aria-selected") === "true"
            || node.classList.contains("selected");
    });

    return {
        question,
        options,
        selectedIndex: selectedIndex >= 0 ? selectedIndex : null
    };
}

function selectAnswerByIndex(index) {
    const optionNodes = getOptionElements();
    const optionIndex = Number(index);
    const target = Number.isInteger(optionIndex) ? optionNodes[optionIndex] : null;
    if (!target) return { success: false, reason: "Option index not found" };

    target.click();
    return { success: true };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "GET_QUESTION_STATE") {
        sendResponse(getQuestionState());
        return false;
    }

    if (request.type === "SELECT_OPTION") {
        sendResponse(selectAnswerByIndex(request.index));
        return false;
    }

    if (request.type === "GET_SELECTED_ANSWER") {
        const state = getQuestionState();
        sendResponse({
            selectedIndex: state.selectedIndex,
            selectedText: state.selectedIndex === null ? null : state.options[state.selectedIndex]
        });
        return false;
    }

    if (request.type === "QUESTION_UPDATED") {
        sendResponse(getQuestionState());
        return false;
    }

    return false;
});

let updateTimer;
const observer = new MutationObserver(() => {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(() => {
        chrome.runtime.sendMessage({ type: "QUESTION_UPDATED" }, () => void chrome.runtime.lastError);
    }, 300);
});

observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
});
