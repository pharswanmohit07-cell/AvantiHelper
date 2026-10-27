Avanti Question Helper - Chrome extension

Install:
1. Open chrome://extensions in Chrome.
2. Turn on Developer mode.
3. Choose Load unpacked and select this folder.
4. Pin the extension if you want quick access.

Use:
1. Open a page containing a multiple-choice question.
2. Sign in to Gemini in Chrome if you have not already.
3. Open the extension popup and choose Load question if the page was not detected automatically.
4. Choose Generate answer. The extension opens Gemini in a new background tab, submits the question and choices, and selects the matching page option when Gemini returns a readable answer.

The extension does not require or store a Gemini API key. It uses your signed-in Gemini website session. The manifest grants access to HTTP and HTTPS pages so the content script can read question text and options, and to run the Gemini website interaction. Review these permissions before installing.

The page detector is generic and may not correctly identify questions on every website. Review Gemini's response; it can be wrong. The extension selects an option only when it can match Gemini's answer, but does not verify correctness against an authoritative answer key.
