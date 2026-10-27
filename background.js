function parseGeminiAnswer(responseText, options) {
    if (!responseText) return null;
    const text = responseText.trim();
    const answerMatch = text.match(/^\s*ANSWER\s*:\s*([1-9]|10)\b/i);
    if (answerMatch) {
        const index = Number(answerMatch[1]) - 1;
        if (index >= 0 && index < options.length) return { index, text: options[index] };
    }

    const letterMatch = text.match(/^\s*ANSWER\s*:\s*([A-J])\b/i);
    if (letterMatch) {
        const index = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
        if (index >= 0 && index < options.length) return { index, text: options[index] };
    }

    const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, "");
    const matched = options.findIndex((option) => {
        const normalizedOption = option.toLowerCase().replace(/[^a-z0-9]/g, "");
        return normalizedOption.length > 2 && normalized.includes(normalizedOption);
    });
    return matched < 0 ? null : { index: matched, text: options[matched] };
}

function waitForTabLoad(tabId) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            error ? reject(error) : resolve();
        };
        const onUpdated = (updatedTabId, changeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === "complete") finish();
        };
        const timeout = setTimeout(() => finish(new Error("Gemini took too long to load.")), 30000);
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError) finish(new Error(chrome.runtime.lastError.message));
            else if (tab?.status === "complete") finish();
    });
    });
}

function runInTab(tabId, func, args = []) {
    return new Promise((resolve, reject) => {
        chrome.scripting.executeScript({ target: { tabId }, func, args }, (results) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(results?.[0]?.result);
        });
    });
}

function sendTabMessage(tabId, message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(response);
        });
    });
}

async function askGeminiInNewTab(question, options, sourceTabId) {
    if (typeof question !== "string" || !question.trim() || !Array.isArray(options) || !options.length) {
        throw new Error("Load a question with at least one option first.");
    }
    if (!Number.isInteger(sourceTabId)) throw new Error("Could not identify the question page.");

    const tab = await new Promise((resolve, reject) => {
        chrome.tabs.create({ url: "https://gemini.google.com/app", active: false }, (createdTab) => {
            if (chrome.runtime.lastError || !createdTab?.id) {
                reject(new Error(chrome.runtime.lastError?.message || "Could not open Gemini."));
            } else {
                resolve(createdTab);
            }
        });
    });

    await waitForTabLoad(tab.id);
    const result = await runInTab(tab.id, async (questionText, choiceList) => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const findComposer = () => document.querySelector('rich-textarea [contenteditable="true"]')
            || document.querySelector('[contenteditable="true"][role="textbox"]')
            || document.querySelector("textarea");
        const findButton = (pattern) => [...document.querySelectorAll("button")].find((button) =>
            pattern.test(`${button.getAttribute("aria-label") || ""} ${button.title || ""} ${button.innerText || ""}`));
        const until = async (lookup, timeoutMs) => {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                const value = lookup();
                if (value) return value;
                await wait(250);
            }
            return null;
        };

        const composer = await until(findComposer, 20000);
        if (!composer) return { error: "Gemini is not ready. Sign in and try again." };
        const prompt = [
            "Solve this multiple-choice question carefully.",
            "Use the provided options. If the question is unclear, say so and do not guess.",
            "Start your response with exactly ANSWER: followed by the option number (1-based), then give a brief explanation.",
            "",
            ...choiceList.map((option, index) => `${index + 1}. ${option}`),
            "",
            `Question: ${questionText}`
        ].join("\n");

        const previousResponse = [...document.querySelectorAll(
            '[data-message-author-role="model"], [data-test-id="model-response"], model-response, .model-response-text'
        )].map((element) => (element.innerText || element.textContent || "").trim()).filter(Boolean).pop() || "";

        composer.focus();
        if (composer instanceof HTMLTextAreaElement) {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(composer, prompt);
        } else {
            composer.textContent = prompt;
        }
        composer.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: prompt
        }));

        const sendButton = await until(() => {
            const button = findButton(/send message|send/i);
            return button && !button.disabled ? button : null;
        }, 10000);
        if (!sendButton) return { error: "Gemini did not enable its Send button." };
        sendButton.click();

        const deadline = Date.now() + 90000;
        let latestResponse = "";
        let stableSince = 0;
        while (Date.now() < deadline) {
            const response = [...document.querySelectorAll(
                '[data-message-author-role="model"], [data-test-id="model-response"], model-response, .model-response-text'
            )].map((element) => (element.innerText || element.textContent || "").trim()).filter(Boolean).pop() || "";
            if (response && response !== previousResponse) {
                if (response !== latestResponse) stableSince = Date.now();
                latestResponse = response;
                const generating = Boolean(document.querySelector(
                    'button[aria-label*="Stop" i], [data-test-id="stop-button"]'
                ));
                if (!generating && Date.now() - stableSince > 2000) return { responseText: response };
            }
            await wait(500);
        }
        return latestResponse
            ? { responseText: latestResponse }
            : { error: "Gemini did not return a readable answer. Check the new tab." };
    }, [question, options]);

    if (!result || result.error) throw new Error(result?.error || "Could not read Gemini's response.");
    const parsed = parseGeminiAnswer(result.responseText, options);
    const answer = {
        index: parsed?.index ?? null,
        text: parsed?.text || "",
        rawAnswer: result.responseText,
        parsedFromGemini: Boolean(parsed),
        tabId: tab.id
    };
    if (!parsed) return answer;

    const selection = await sendTabMessage(sourceTabId, { type: "SELECT_OPTION", index: parsed.index });
    if (!selection?.success) {
        answer.selectionError = selection?.reason || "Could not select the suggested option.";
        return answer;
    }
    const selected = await sendTabMessage(sourceTabId, { type: "GET_SELECTED_ANSWER" });
    answer.selectedIndex = selected?.selectedIndex ?? null;
    answer.selectionSuccess = answer.selectedIndex === parsed.index;
    return answer;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GENERATE_ANSWER") {
        askGeminiInNewTab(message.question, message.options, message.tabId)
            .then((result) => sendResponse({ success: true, result }))
            .catch((error) => sendResponse({ success: false, error: error.message || "Gemini request failed." }));
        return true;
    }

    if (message.type === "QUESTION_UPDATED" && sender.tab) {
        chrome.runtime.sendMessage({ ...message, tabId: sender.tab.id }, () => {
            void chrome.runtime.lastError;
        });
        return false;
    }

    return false;
});
