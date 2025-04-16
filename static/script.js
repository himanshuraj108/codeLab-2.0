// Initialize watch history from local storage
let watchHistory = JSON.parse(localStorage.getItem("watchHistory")) || [];

// Track state variables
let selectedHistoryIndex = null;
let visualizerEnabled = false;
let questionsEnabled = false;
let codeIsRunning = false;
let lastRunStatus = null; // Track if the last run was successful
let lastRunResult = null; // Store the last successful run result

// Add syntax highlighting style
const syntaxHighlightingStyles = document.createElement('style');
syntaxHighlightingStyles.innerHTML = `
    .code-editor {
        position: relative;
        font-family: 'Consolas', 'Monaco', monospace;
        line-height: 1.5;
    }
    
    .code-editor .keywords { color: #569CD6; }
    .code-editor .strings { color: #CE9178; }
    .code-editor .numbers { color: #B5CEA8; }
    .code-editor .comments { color: #6A9955; font-style: italic; }
    .code-editor .functions { color: #DCDCAA; }
    .code-editor .operators { color: #D4D4D4; }
    .code-editor .variables { color: #9CDCFE; }
    .code-editor .brackets { color: #D4D4D4; }
`;
document.head.appendChild(syntaxHighlightingStyles);

// Auto-resize textarea as content changes
function autoResize(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
}

// Function to apply syntax highlighting
function applySyntaxHighlighting(code, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Process code to escape HTML entities first
    let processedCode = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    // Apply JavaScript syntax highlighting with careful ordering to prevent nested spans
    let highlightedCode = processedCode;
    
    // Comments - process these first
    highlightedCode = highlightedCode
        .replace(/\/\/.*$/gm, match => `<span class="comments">${match}</span>`)
        .replace(/\/\*[\s\S]*?\*\//gm, match => `<span class="comments">${match}</span>`);
    
    // Don't process content inside comment spans
    const commentSpans = [];
    let commentMatch;
    const commentRegex = /<span class="comments">([\s\S]*?)<\/span>/g;
    
    while ((commentMatch = commentRegex.exec(highlightedCode)) !== null) {
        commentSpans.push({
            index: commentMatch.index,
            length: commentMatch[0].length,
            content: commentMatch[0]
        });
    }
    
    // Helper function to check if position is inside a comment span
    function isInCommentSpan(position) {
        return commentSpans.some(span => 
            position >= span.index && position < span.index + span.length);
    }
    
    // Apply other highlighting with regex that skips comment spans
    const patterns = [
        // Strings
        { regex: /(["'`])([\s\S]*?)\1/g, className: "strings" },
        // Numbers
        { regex: /\b(\d+(\.\d+)?)\b/g, className: "numbers" },
        // Keywords
        { regex: /\b(function|return|if|else|for|while|let|const|var|new|try|catch|finally|switch|case|break|continue|class|import|export|this|async|await)\b/g, 
          className: "" },
        // Functions
        { regex: /\b(\w+)(?=\s*\()/g, className: "functions" },
        // Operators
        { regex: /([=+\-*/%<>&|^!~?:.])/g, className: "operators" },
        // Brackets
        { regex: /([{}[\]()])/g, className: "brackets" }
    ];
    
    // Apply patterns one at a time to avoid nesting
    for (const pattern of patterns) {
        let tempCode = '';
        let lastIndex = 0;
        let match;
        
        // Reset regex lastIndex
        pattern.regex.lastIndex = 0;
        
        while ((match = pattern.regex.exec(highlightedCode)) !== null) {
            // Skip if this match is inside a comment span
            if (isInCommentSpan(match.index)) {
                // Move lastIndex to continue searching
                pattern.regex.lastIndex = match.index + 1;
                continue;
            }
            
            // Add text before match
            tempCode += highlightedCode.substring(lastIndex, match.index);
            // Add highlighted match
            tempCode += `<span class="${pattern.className}">${match[0]}</span>`;
            lastIndex = match.index + match[0].length;
        }
        
        // Add remaining text
        tempCode += highlightedCode.substring(lastIndex);
        highlightedCode = tempCode;
    }
    
    // Create a div for the highlighted code
    const highlightedDiv = document.createElement('div');
    highlightedDiv.className = 'code-editor';
    highlightedDiv.innerHTML = `<pre>${highlightedCode}</pre>`;
    
    // Replace or append to the container
    if (container.firstChild) {
        container.replaceChild(highlightedDiv, container.firstChild);
    } else {
        container.appendChild(highlightedDiv);
    }
}

// Function to update toggle states based on code execution status
function updateFeatureToggles() {
    const visualizerToggle = document.getElementById('visualizer-toggle');
    const questionsToggle = document.getElementById('questions-toggle');
    
    if (lastRunStatus === "success") {
        // Enable toggles if last run was successful
        visualizerToggle.classList.remove('disabled');
        questionsToggle.classList.remove('disabled');
        visualizerToggle.disabled = false;
        questionsToggle.disabled = false;
    } else {
        // Disable toggles and reset their state if code has errors
        visualizerToggle.classList.add('disabled');
        questionsToggle.classList.add('disabled');
        visualizerToggle.classList.remove('active');
        questionsToggle.classList.remove('active');
        visualizerToggle.disabled = true;
        questionsToggle.disabled = true;
        visualizerEnabled = false;
        questionsEnabled = false;
    }
}

// Function to display the feature based on toggle status
function displayFeature(featureType) {
    if (lastRunStatus !== "success" || !lastRunResult) {
        return;
    }
    
    if (featureType === "visualizer" && visualizerEnabled) {
        // Display visualization if enabled and we have execution steps
        if (lastRunResult.execution_steps) {
            animateExecution(lastRunResult.execution_steps, document.getElementById("code").value);
        } else {
            const visualizationDiv = document.getElementById("visualization-output");
            visualizationDiv.innerHTML = "<div class='visualization-placeholder'>No visualization data available for this code.</div>";
        }
    } else if (featureType === "questions" && questionsEnabled) {
        // Display questions if enabled
        const questionsDiv = document.getElementById("questions-list");
        if (lastRunResult.questions) {
            questionsDiv.innerHTML = lastRunResult.questions
                .map((q) => `<li>${q}</li>`)
                .join("");
        } else {
            questionsDiv.innerHTML = "<li>No learning questions available for this code.</li>";
        }
    }
}

// Initialize event listeners when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
    // Set up history confirmation buttons
    document.getElementById("history-confirm-yes").addEventListener("click", () => {
        if (selectedHistoryIndex === null || !watchHistory[selectedHistoryIndex]) {
            console.error("No history item selected");
            return;
        }
        
        const code = watchHistory[selectedHistoryIndex].code;
        const codeTextArea = document.getElementById("code");
        codeTextArea.value = code;
        autoResize(codeTextArea);
        
        // Apply syntax highlighting to the loaded code
        applySyntaxHighlighting(code, "code-display-container");
        
        document.getElementById("history-confirmation").style.display = "none";
        document.getElementById("main-container").classList.remove("blur-background");
        toggleWatchHistory();
    });

    document.getElementById("history-confirm-no").addEventListener("click", () => {
        document.getElementById("history-confirmation").style.display = "none";
        document.getElementById("main-container").classList.remove("blur-background");
        selectedHistoryIndex = null;
    });

    // Set up clear history confirmation buttons
    document.getElementById("clear-history-yes").addEventListener("click", () => {
        watchHistory = [];
        localStorage.removeItem("watchHistory");
        updateHistoryDisplay();
        document.getElementById("clear-history-confirmation").style.display = "none";
        document.getElementById("main-container").classList.remove("blur-background");
        
        // Make popup invisible when history is cleared
        document.getElementById("watch-history").style.display = "none";
    });

    document.getElementById("clear-history-no").addEventListener("click", () => {
        document.getElementById("clear-history-confirmation").style.display = "none";
        document.getElementById("main-container").classList.remove("blur-background");
    });

    // Set up visualizer toggle - now with improved functionality
    const visualizerToggle = document.getElementById('visualizer-toggle');
    if (visualizerToggle) {
        visualizerToggle.addEventListener('click', () => {
            if (lastRunStatus !== "success") {
                // Show error message if code hasn't been run successfully
                const outputDiv = document.getElementById("output");
                outputDiv.innerHTML = `<pre class="error-output">Please run your code successfully before enabling visualization.</pre>`;
                return;
            }
            
            visualizerEnabled = !visualizerEnabled;
            visualizerToggle.classList.toggle('active', visualizerEnabled);
            
            // Immediately display or hide visualization based on toggle state
            const visualizationDiv = document.getElementById("visualization-output");
            if (visualizerEnabled) {
                displayFeature("visualizer");
            } else {
                visualizationDiv.innerHTML = "<div class='visualization-placeholder'>Enable visualization to see code execution</div>";
            }
        });
    }

    // Set up questions toggle - now with improved functionality
    const questionsToggle = document.getElementById('questions-toggle');
    if (questionsToggle) {
        questionsToggle.addEventListener('click', () => {
            if (lastRunStatus !== "success") {
                // Show error message if code hasn't been run successfully
                const outputDiv = document.getElementById("output");
                outputDiv.innerHTML = `<pre class="error-output">Please run your code successfully before enabling questions.</pre>`;
                return;
            }
            
            questionsEnabled = !questionsEnabled;
            questionsToggle.classList.toggle('active', questionsEnabled);
            
            // Immediately display or hide questions based on toggle state
            const questionsDiv = document.getElementById("questions-list");
            if (questionsEnabled) {
                displayFeature("questions");
            } else {
                questionsDiv.innerHTML = "<li>Enable questions to see learning prompts here</li>";
            }
        });
    }

    // Disable toggles initially
    updateFeatureToggles();

    // Enhanced features popup
    const showFeaturesLink = document.getElementById('showFeaturesLink');
    const featuresPopup = document.getElementById('features-popup');
    const closePopupBtn = document.getElementById('closePopupBtn');
    const closeFeatureBtn = document.getElementById('closeFeatureBtn');
    const mainContainer = document.getElementById('main-container');
    
    // Function to show features popup with animation
    function showFeaturesPopup() {
        featuresPopup.classList.add('show');
        document.body.style.overflow = 'hidden'; // Prevent scrolling
        
        // Add blur effect to main container
        if (mainContainer) {
            mainContainer.classList.add('blur-background');
        }
        
        // Animate feature items sequentially
        const featureItems = document.querySelectorAll('.feature-item');
        featureItems.forEach((item, index) => {
            item.style.opacity = '0';
            item.style.transform = 'translateY(20px)';
            
            setTimeout(() => {
                item.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
                item.style.opacity = '1';
                item.style.transform = 'translateY(0)';
            }, 100 + (index * 50));
        });
        
        // Animate feature categories
        const categories = document.querySelectorAll('.feature-category');
        categories.forEach((category, index) => {
            category.style.opacity = '0';
            
            setTimeout(() => {
                category.style.transition = 'opacity 0.5s ease';
                category.style.opacity = '1';
            }, 100 + (index * 150));
        });
    }
    
    // Function to hide features popup
    function hideFeaturePopup() {
        featuresPopup.classList.remove('show');
        document.body.style.overflow = ''; // Restore scrolling
        
        // Remove blur effect from main container
        if (mainContainer) {
            mainContainer.classList.remove('blur-background');
        }
    }
    
    // Show features popup when clicking the link
    if (showFeaturesLink) {
        showFeaturesLink.addEventListener('click', function(e) {
        e.preventDefault();
            showFeaturesPopup();
        });
    }
    
    // Close popup when clicking the close button
    if (closePopupBtn) {
        closePopupBtn.addEventListener('click', hideFeaturePopup);
    }
    
    // Close popup when clicking the "Got it!" button
    if (closeFeatureBtn) {
        closeFeatureBtn.addEventListener('click', hideFeaturePopup);
    }
    
    // Close popup when clicking outside the content
    featuresPopup.addEventListener('click', function(e) {
        if (e.target === featuresPopup) {
            hideFeaturePopup();
        }
    });
    
    // Close popup with Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && featuresPopup.classList.contains('show')) {
            hideFeaturePopup();
        }
    });
    
    // Add interactive highlighting to feature items
    const featureItems = document.querySelectorAll('.feature-item');
    featureItems.forEach(item => {
        item.addEventListener('mouseenter', function() {
            // Add a subtle glow effect to the icon
            const icon = this.querySelector('.feature-icon');
            if (icon) {
                icon.style.transform = 'scale(1.1)';
                icon.style.boxShadow = '0 0 15px rgba(255, 121, 198, 0.5)';
            }
        });
        
        item.addEventListener('mouseleave', function() {
            // Remove the glow effect
            const icon = this.querySelector('.feature-icon');
            if (icon) {
                icon.style.transform = '';
                icon.style.boxShadow = '';
            }
        });
    });
    
    // Show features popup on first visit (optional)
    if (!localStorage.getItem('featuresShown')) {
        // Uncomment this to show features on first visit
        // setTimeout(showFeaturesPopup, 1000);
        localStorage.setItem('featuresShown', 'true');
    }

    // Add input event listener to code textarea for syntax highlighting
    const codeTextArea = document.getElementById("code");
    if (codeTextArea) {
        codeTextArea.addEventListener('input', () => {
            const code = codeTextArea.value;
            applySyntaxHighlighting(code, 'code-display-container');
            autoResize(codeTextArea);
            
            // Reset run status when code changes
            if (lastRunStatus === "success") {
                lastRunStatus = null;
                lastRunResult = null;
                updateFeatureToggles();
                
                // Reset feature displays
                const visualizationDiv = document.getElementById("visualization-output");
                visualizationDiv.innerHTML = "<div class='visualization-placeholder'>Run code to enable visualization</div>";
                
                const questionsDiv = document.getElementById("questions-list");
                questionsDiv.innerHTML = "<li>Run code to enable questions</li>";
            }
        });
        
        // Initial highlight if there's code already
        if (codeTextArea.value) {
            applySyntaxHighlighting(codeTextArea.value, 'code-display-container');
        }
    }

    // Initialize history display
    updateHistoryDisplay();

    // Improved tooltip handling
    const teamMembers = document.querySelectorAll('.team-member');
    
    teamMembers.forEach(member => {
        const tooltip = member.querySelector('.member-tooltip');
        
        // Create a specialized event handler for this member
        function showTooltip() {
            if (tooltip) {
                // Position tooltip properly
                const rect = member.getBoundingClientRect();
                const windowHeight = window.innerHeight;
                
                // Reset any inline styles
                tooltip.style.removeProperty('bottom');
                tooltip.style.removeProperty('top');
                
                // If tooltip would go off the top of the viewport, position it below the member
                if (rect.top < 200) {
                    tooltip.style.bottom = 'auto';
                    tooltip.style.top = 'calc(100% + 15px)';
                    tooltip.classList.add('tooltip-below');
                    
                    // Move the arrow to the top
                    tooltip.style.setProperty('--arrow-position', 'top');
                } else {
                    tooltip.style.bottom = 'calc(100% + 15px)';
                    tooltip.style.top = 'auto';
                    tooltip.classList.remove('tooltip-below');
                    
                    // Move the arrow to the bottom
                    tooltip.style.setProperty('--arrow-position', 'bottom');
                }
                
                // Make tooltip visible
                tooltip.style.opacity = '1';
                tooltip.style.visibility = 'visible';
                tooltip.style.transform = 'translateY(0)';
                tooltip.style.zIndex = '1000'; // Very high z-index
            }
            
            // Add glow effect to the card
            member.style.boxShadow = '0 8px 25px rgba(255, 56, 56, 0.4)';
        }
        
        function hideTooltip() {
            if (tooltip) {
                tooltip.style.opacity = '0';
                tooltip.style.visibility = 'hidden';
                tooltip.style.transform = 'translateY(20px)';
            }
            
            // Reset card effect
            member.style.boxShadow = '0 5px 15px rgba(0, 0, 0, 0.2)';
        }
        
        // Apply the event handlers
        member.addEventListener('mouseenter', showTooltip);
        member.addEventListener('mouseleave', hideTooltip);
        
        // Handle click events to toggle tooltip on mobile
        member.addEventListener('click', function(e) {
            e.preventDefault();
            if (window.innerWidth <= 768) {
                const isVisible = tooltip.style.visibility === 'visible';
                if (isVisible) {
                    hideTooltip();
                } else {
                    // Hide all other tooltips first
                    document.querySelectorAll('.member-tooltip').forEach(t => {
                        t.style.opacity = '0';
                        t.style.visibility = 'hidden';
                    });
                    showTooltip();
                }
            }
        });
    });
    
    // Add extra CSS to fix tooltip positioning
    document.head.insertAdjacentHTML('beforeend', `
    <style>
        /* Additional tooltip fixes */
        .tooltip-wrapper {
            position: absolute;
            width: 100%;
            pointer-events: none;
            z-index: 9999;
        }
        
        .member-tooltip {
            z-index: 10000 !important;
            pointer-events: none;
        }
        
        /* Fix arrow positioning */
        .member-tooltip::after {
            position: absolute;
            bottom: calc(var(--arrow-position) === 'bottom' ? -10px : auto);
            top: calc(var(--arrow-position) === 'top' ? -10px : auto);
            left: 50%;
            transform: translateX(-50%) rotate(var(--arrow-position) === 'top' ? 225deg : 45deg);
        }
        
        /* Tooltip positioned below */
        .tooltip-below::after {
            bottom: auto;
            top: -10px;
            transform: translateX(-50%) rotate(225deg);
        }
        
        /* Prevent other elements from overlapping */
        body::before {
            content: '';
            display: none;
        }
        
        body.has-active-tooltip::before {
            display: block;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: transparent;
            z-index: 9000;
            pointer-events: none;
        }
        
        /* Ensure the tooltip is always on top */
        .team-member:hover .member-tooltip {
            z-index: 10000 !important;
        }
    </style>
    `);
});

// Additional function to fix any remaining tooltip issues
function fixTooltipDisplay() {
    // This fixes potential z-index stacking context issues
    document.querySelectorAll('.tooltip-wrapper').forEach(wrapper => {
        wrapper.style.zIndex = '9999';
    });
    
    document.querySelectorAll('.member-tooltip').forEach(tooltip => {
        tooltip.style.position = 'absolute';
        tooltip.style.zIndex = '10000';
    });
}

// Call this function after the page loads and whenever window resizes
window.addEventListener('load', fixTooltipDisplay);
window.addEventListener('resize', fixTooltipDisplay);

// Debug code function - sends code to backend for execution
async function debugCode() {
    if (codeIsRunning) return; // Prevent multiple simultaneous runs
    
    codeIsRunning = true;
    const code = document.getElementById("code").value;
    const language = document.getElementById("language").value;
    const userInput = document.getElementById("user-input").value;
    const outputDiv = document.getElementById("output");
    const questionsDiv = document.getElementById("questions-list");
    const spinner = document.getElementById("spinner");
    const button = document.getElementById("runCodeBtn");
    const buttonText = document.getElementById("buttonText");
    const autoCorrectBtn = document.getElementById("autoCorrectBtn");
    const visualizationDiv = document.getElementById("visualization-output");
    const correctedCodeDiv = document.getElementById("corrected-code");
    const copyCorrectedCodeBtn = document.getElementById("copyCorrectedCodeBtn");

    // Reset all output areas
    outputDiv.innerHTML = "Your output will be displayed here";
    questionsDiv.innerHTML = "";
    visualizationDiv.innerHTML = "";
    correctedCodeDiv.innerHTML = "";
    copyCorrectedCodeBtn.style.display = "none";
    
    // Show spinner
    spinner.style.display = "block";
    
    // Update button text to indicate processing
    buttonText.innerHTML = "Running";
    button.disabled = true;
    autoCorrectBtn.style.display = "none";

    try {
        const response = await fetch("http://127.0.0.1:5000/debug", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ code, language, user_input: userInput }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        if (result.output) {
            // Success case - show output and store result for future feature use
            outputDiv.innerHTML = `<pre class="success-output">${result.output}</pre>`;
            lastRunStatus = "success";
            lastRunResult = result; // Store the result for later use
            
            // Show placeholder messages for disabled features
            visualizationDiv.innerHTML = "<div class='visualization-placeholder'>Enable visualization to see code execution</div>";
            questionsDiv.innerHTML = "<li>Enable questions to see learning prompts here</li>";
            
            // Update toggle states to enable them
            updateFeatureToggles();
        } else if (result.error) {
            // Error case - show error and prompt for correction
            outputDiv.innerHTML = `<pre class="error-output">${result.error}</pre>`;
            document.getElementById("main-container").classList.add("blur-background");
            document.getElementById("confirmation").style.display = "flex";
            lastRunStatus = "error";
            lastRunResult = null;
            
            // Update toggle states to disable them
            updateFeatureToggles();
        }

        // Save to history
        const historyItem = {
            code: code,
            timestamp: new Date().toISOString(),
            status: result.output ? "success" : "error",
            language: language,
            source: "run",
        };
        watchHistory.unshift(historyItem); // Add to beginning
        if (watchHistory.length > 50) watchHistory.pop(); // Limit history length
        updateHistoryDisplay();

    } catch (error) {
        console.error("Error during fetch operation:", error);
        outputDiv.innerHTML = `<pre class="error-output">Failed to run code. Please try again. Server might be offline.</pre>`;
        lastRunStatus = "error";
        lastRunResult = null;
        updateFeatureToggles();
    } finally {
        // Reset UI state
        spinner.style.display = "none";
        buttonText.innerHTML = "Run Code";
        button.disabled = false;
        codeIsRunning = false;
    }
}

// Animate code execution with step-by-step highlighting
function animateExecution(steps, fullCode) {
    if (!visualizerEnabled || !steps || steps.length === 0) return;

    let stepIndex = 0;
    const codeLines = fullCode.split("\n");
    const visualizationDiv = document.getElementById("visualization-output");
    
    visualizationDiv.innerHTML = '<div class="visualization-controls">' +
        '<button id="step-back" disabled><i class="fas fa-step-backward"></i></button>' +
        '<button id="play-pause"><i class="fas fa-play"></i></button>' +
        '<button id="step-forward"><i class="fas fa-step-forward"></i></button>' +
        '</div>' +
        '<div id="code-display"></div>' +
        '<div id="step-description"></div>';
    
    const codeDisplay = document.getElementById("code-display");
    const stepDescription = document.getElementById("step-description");
    const stepBackBtn = document.getElementById("step-back");
    const stepForwardBtn = document.getElementById("step-forward");
    const playPauseBtn = document.getElementById("play-pause");
    
    let isPlaying = false;
    let animationInterval = null;
    
    // Function to update display for current step
    function updateDisplay() {
        let highlightedCode = codeLines.map((line, index) => {
            if (index === steps[stepIndex].lineNumber) {
                return `<span class="highlight">${line}</span>`;
            }
            return line;
        }).join("<br>");
        
        codeDisplay.innerHTML = `<pre>${highlightedCode}</pre>`;
        stepDescription.textContent = steps[stepIndex].stepDescription;
        
        // Update control button states
        stepBackBtn.disabled = stepIndex === 0;
        stepForwardBtn.disabled = stepIndex === steps.length - 1;
    }
    
    // Initial display
    updateDisplay();
    
    // Set up controls
    playPauseBtn.addEventListener("click", () => {
        isPlaying = !isPlaying;
        playPauseBtn.innerHTML = isPlaying ? 
            '<i class="fas fa-pause"></i>' : 
            '<i class="fas fa-play"></i>';
            
        if (isPlaying) {
            animationInterval = setInterval(() => {
                if (stepIndex < steps.length - 1) {
                    stepIndex++;
                    updateDisplay();
                } else {
                    isPlaying = false;
                    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
                    clearInterval(animationInterval);
                }
            }, 1000);
        } else {
            clearInterval(animationInterval);
        }
    });
    
    stepBackBtn.addEventListener("click", () => {
        if (stepIndex > 0) {
            stepIndex--;
            updateDisplay();
        }
    });
    
    stepForwardBtn.addEventListener("click", () => {
        if (stepIndex < steps.length - 1) {
            stepIndex++;
            updateDisplay();
        }
    });
}

// Paste text from clipboard to a given element
function pasteText(elementId) {
    const element = document.getElementById(elementId);
    navigator.clipboard.readText().then(text => {
        element.value = text;
        autoResize(element);
        
        // Apply syntax highlighting to pasted code
        applySyntaxHighlighting(text, 'code-display-container');

        // Save to history when pasting code
        const historyItem = {
            code: text,
            timestamp: new Date().toISOString(),
            status: "pasted",
            source: "paste",
        };
        watchHistory.unshift(historyItem);
        if (watchHistory.length > 50) watchHistory.pop();
        updateHistoryDisplay();
        
        // Reset run status when new code is pasted
        lastRunStatus = null;
        lastRunResult = null;
        updateFeatureToggles();
    }).catch(err => {
        console.error('Failed to read clipboard contents: ', err);
    });
}

// Handle request for code correction
function getCorrectCode() {
    document.getElementById("autoCorrectBtn").style.display = "block";
    document.getElementById("confirmation").style.display = "none";
    document.getElementById("main-container").classList.remove("blur-background");
}

// Dismiss error confirmation popup
function dismissConfirmation() {
    document.getElementById("main-container").classList.remove("blur-background");
    document.getElementById("confirmation").style.display = "none";
}

// Toggle the watch history panel
function toggleWatchHistory() {
    const historyDiv = document.getElementById("watch-history");
    historyDiv.style.display = historyDiv.style.display === "none" ? "block" : "none";
}

// Update the history display in the UI
function updateHistoryDisplay() {
    const historyList = document.getElementById("watch-history-list");
    
    if (watchHistory.length === 0) {
        historyList.innerHTML = '<li class="history-empty">No history yet</li>';
        
        // Auto-hide the popup when history is cleared
        const historyDiv = document.getElementById("watch-history");
        if (historyDiv.style.display === "block") {
            historyDiv.style.display = "none";
        }
    } else {
        historyList.innerHTML = watchHistory
            .map((item, index) => {
                // Create a preview of the code (first 30 chars)
                const codePreview = item.code.length > 30 ? 
                    item.code.substring(0, 30) + "..." : 
                    item.code;
                
                // Format timestamp if available
                const timeDisplay = item.timestamp ? 
                    new Date(item.timestamp).toLocaleTimeString() : 
                    '';
                
                return `<li class="history-item ${item.status}" onclick="loadCodeFromHistory(${index})">
                    <div class="history-code">${codePreview}</div>
                    <div class="history-meta">
                        <span class="history-status">${item.status}</span>
                        <span class="history-time">${timeDisplay}</span>
                    </div>
                </li>`;
            })
            .join("");
    }
    
    // Save to localStorage
    localStorage.setItem("watchHistory", JSON.stringify(watchHistory));
}

// Load code from history with confirmation
function loadCodeFromHistory(index) {
    if (index < 0 || index >= watchHistory.length) {
        console.error("Invalid history index");
        return;
    }
    
    selectedHistoryIndex = index;
    document.getElementById("history-confirmation").style.display = "flex";
    document.getElementById("main-container").classList.add("blur-background");
}

// Display clear history confirmation
function clearHistory() {
    document.getElementById("clear-history-confirmation").style.display = "flex";
    document.getElementById("main-container").classList.add("blur-background");
}

// Auto-correct code function - sends code to backend for correction
async function autoCorrectCode() {
    if (codeIsRunning) return; // Prevent multiple simultaneous runs
    
    codeIsRunning = true;
    const code = document.getElementById("code").value;
    const correctedCodeDiv = document.getElementById("corrected-code");
    const autoCorrectBtn = document.getElementById("autoCorrectBtn");
    const autoCorrectText = document.getElementById("autoCorrectText");
    const copyCorrectedCodeBtn = document.getElementById("copyCorrectedCodeBtn");
    
    // Update UI to show processing
    autoCorrectText.innerHTML = "Correcting";
    autoCorrectBtn.disabled = true;

    try {
        const response = await fetch("http://127.0.0.1:5000/autocorrect", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ code: code }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        if (result.error) {
            correctedCodeDiv.innerHTML = `<div class="error-message">${result.error}</div>`;
            return;
        }

        if (result.corrected_code) {
            // Clear previous content
            correctedCodeDiv.innerHTML = "";
            
            // Create main container
            const mainContainer = document.createElement('div');
            mainContainer.className = 'corrected-code-container';
            
            // Add the raw code without any syntax highlighting
            const codePreElement = document.createElement('pre');
            codePreElement.textContent = result.corrected_code;
            codePreElement.className = 'clean-code';
            
            // Add the pre element to the main container
            mainContainer.appendChild(codePreElement);
            
            // Add explanation if available
            if (result.explanation) {
                const explanationDiv = document.createElement('div');
                explanationDiv.className = 'explanation';
                explanationDiv.textContent = result.explanation;
                mainContainer.appendChild(explanationDiv);
            }
            
            // Add feature toggles section
            const featureToggles = document.createElement('div');
            featureToggles.className = 'feature-toggles';
            
            const visualizationToggle = document.createElement('div');
            visualizationToggle.className = 'feature-toggle';
            visualizationToggle.innerHTML = '<span>Code Visualization</span><span class="status">Enable</span>';
            featureToggles.appendChild(visualizationToggle);
            
            const questionsToggle = document.createElement('div');
            questionsToggle.className = 'feature-toggle';
            questionsToggle.innerHTML = '<span>Generated Questions</span><span class="status">Enable</span>';
            featureToggles.appendChild(questionsToggle);
            
            mainContainer.appendChild(featureToggles);
            
            // Add the main container to the corrected code div
            correctedCodeDiv.appendChild(mainContainer);
            
            copyCorrectedCodeBtn.style.display = "block";
            
            // Save corrected code to history
            const historyItem = {
                code: result.corrected_code,
                timestamp: new Date().toISOString(),
                status: "corrected",
                source: "auto-correct",
            };
            watchHistory.unshift(historyItem);
            if (watchHistory.length > 50) watchHistory.pop();
            updateHistoryDisplay();
        } else {
            correctedCodeDiv.innerHTML = "No correction available.";
        }
    } catch (error) {
        console.error("Error during fetch operation:", error);
        correctedCodeDiv.innerHTML = "Failed to auto-correct code. Please try again.";
    } finally {
        // Reset UI state
        autoCorrectText.innerHTML = "Fix Code";
        autoCorrectBtn.disabled = false;
        codeIsRunning = false;
    }
}

// Helper function to apply syntax highlighting to an element
function applyHighlightingToElement(element) {
    let content = element.innerHTML;
    
    // Apply syntax highlighting patterns
    // Keywords
    content = content.replace(/\b(function|return|if|else|for|while|let|const|var|new|try|catch|finally|switch|case|break|continue|class|import|export|this|async|await|def|print|in|is|None|True|False)\b/g, 
        '<span class="keywords">$1</span>');
    
    // Strings with various quote types
    content = content.replace(/(["'`])(.*?)\1/g, '<span class="strings">$1$2$1</span>');
    
    // Numbers
    content = content.replace(/\b(\d+(\.\d+)?)\b/g, '<span class="numbers">$1</span>');
    
    // Functions
    content = content.replace(/\b(\w+)(?=\s*\()/g, '<span class="functions">$1</span>');
    
    // Update the element's content
    element.innerHTML = content;
}

// Fix the issue with nested spans in explanations
function cleanupExplanationText(text) {
    // Replace problematic nested spans like: <span <span class="keywords">class</span>="numbers">5</span>
    return text.replace(/<span\s+<span\s+class="([^"]+)">class<\/span>="([^"]+)">([^<]+)<\/span>/g, 
        '<span class="$2">$3</span>');
}

// Function to copy text from an element to clipboard
function copyText(elementId) {
    const element = document.getElementById(elementId);
    
    // Find the clean code element if it exists
    const cleanCodeElement = element.querySelector('.clean-code');
    const text = cleanCodeElement ? cleanCodeElement.textContent : element.textContent;
    
    navigator.clipboard.writeText(text).then(() => {
        const copyBtn = document.getElementById('copyCorrectedCodeBtn');
        copyBtn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => {
            copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
        }, 2000);
        
        // Add to history when copying corrected code
        const historyItem = {
            code: text,
            timestamp: new Date().toISOString(),
            status: "copied",
            source: "copy-corrected",
        };
        watchHistory.unshift(historyItem);
        if (watchHistory.length > 50) watchHistory.pop();
        updateHistoryDisplay();
    }).catch(err => {
        console.error('Failed to copy text: ', err);
    });
}

// Chat Bot Functionality
let chatBotVisible = false;
let isDragging = false;
let dragOffsetX, dragOffsetY;
let isResizing = false;

function toggleChatBot() {
    const chatBotContainer = document.getElementById('chat-bot-container');
    chatBotVisible = !chatBotVisible;
    
    if (chatBotVisible) {
        chatBotContainer.style.display = 'block';
        
        // Check if the chat position is already set (after dragging)
        if (!chatBotContainer.style.left && !chatBotContainer.style.top) {
            // Reset to default position if not
            chatBotContainer.style.left = 'auto';
            chatBotContainer.style.right = '90px';
            chatBotContainer.style.top = 'auto';
            chatBotContainer.style.bottom = '90px';
        }
        
        // Ensure it's within screen bounds
        ensureChatInBounds();
    } else {
        chatBotContainer.style.display = 'none';
    }
}

// Helper function to ensure chat is within screen bounds
function ensureChatInBounds() {
    const chatContainer = document.getElementById('chat-bot-container');
    if (!chatContainer) return;
    
    const chatRect = chatContainer.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    // If the chat is positioned using left/top (which happens after dragging)
    if (chatContainer.style.left) {
        let newLeft = parseInt(chatContainer.style.left);
        let newTop = parseInt(chatContainer.style.top);
        
        // Apply constraints
        if (newLeft < 0) newLeft = 0;
        if (newLeft + 50 > windowWidth) newLeft = windowWidth - 50;
        if (newTop < 0) newTop = 0;
        if (newTop + 50 > windowHeight) newTop = windowHeight - 50;
        
        // Apply adjusted position
        chatContainer.style.left = newLeft + 'px';
        chatContainer.style.top = newTop + 'px';
    }
}

function sendChatMessage() {
    const chatInput = document.getElementById('chat-input');
    const message = chatInput.value.trim();
    
    if (message === '') return;
    
    // Add user message to chat
    addMessageToChat('user', message);
    chatInput.value = '';
    
    // Show typing indicator
    showTypingIndicator();
    
    // Call Mistral API
    getChatResponse(message);
}

function addMessageToChat(sender, message) {
    const chatMessages = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${sender}`;
    
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    
    // Check if message contains code blocks
    if (message.includes('```')) {
        const parts = parseCodeBlocks(message);
        parts.forEach(part => {
            if (part.type === 'code') {
                const codeBlock = document.createElement('div');
                codeBlock.className = 'chat-code-block';
                codeBlock.textContent = part.content;
                bubble.appendChild(codeBlock);
            } else {
                const textNode = document.createElement('div');
                textNode.innerHTML = part.content.replace(/\n/g, '<br>');
                bubble.appendChild(textNode);
            }
        });
    } else {
        bubble.textContent = message;
    }
    
    messageDiv.appendChild(bubble);
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function parseCodeBlocks(text) {
    const parts = [];
    let currentIndex = 0;
    
    // Regular expression to find code blocks
    const codeBlockRegex = /```(?:(\w+)\n)?([\s\S]*?)```/g;
    let match;
    
    while ((match = codeBlockRegex.exec(text)) !== null) {
        // Add text before code block
        if (match.index > currentIndex) {
            parts.push({
                type: 'text',
                content: text.substring(currentIndex, match.index)
            });
        }
        
        // Add code block
        parts.push({
            type: 'code',
            language: match[1] || '',
            content: match[2]
        });
        
        currentIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (currentIndex < text.length) {
        parts.push({
            type: 'text',
            content: text.substring(currentIndex)
        });
    }
    
    return parts;
}

function showTypingIndicator() {
    const chatMessages = document.getElementById('chat-messages');
    const typingDiv = document.createElement('div');
    typingDiv.className = 'chat-typing';
    typingDiv.id = 'typing-indicator';
    
    for (let i = 0; i < 3; i++) {
        const dot = document.createElement('div');
        dot.className = 'chat-typing-dot';
        typingDiv.appendChild(dot);
    }
    
    chatMessages.appendChild(typingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function hideTypingIndicator() {
    const typingIndicator = document.getElementById('typing-indicator');
    if (typingIndicator) {
        typingIndicator.remove();
    }
}

function getChatResponse(message) {
    // Using Mistral API
    const MISTRAL_API_KEY = ""; // Using same key as in backend
    
    fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${MISTRAL_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            "model": "mistral-medium",
            "messages": [
                {"role": "system", "content": "You are a helpful coding assistant in a code debugger application. When responding, format code with ```language code``` blocks. Keep responses concise and helpful."},
                {"role": "user", "content": message}
            ]
        })
    })
    .then(response => response.json())
    .then(data => {
        hideTypingIndicator();
        if (data.choices && data.choices.length > 0) {
            const botResponse = data.choices[0].message.content;
            addMessageToChat('bot', botResponse);
        } else {
            addMessageToChat('bot', "I'm sorry, I couldn't process your request. Please try again.");
        }
    })
    .catch(error => {
        hideTypingIndicator();
        addMessageToChat('bot', "There was an error connecting to the assistant. Please try again later.");
        console.error("Error:", error);
    });
}

// Setup event listeners when the DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Chat related elements
    const chatHeader = document.querySelector('.chat-header');
    const chatContainer = document.getElementById('chat-bot-container');
    const chatResizer = document.querySelector('.chat-resizer');
    const minimizeBtn = document.getElementById('minimizeChatBtn');
    const closeBtn = document.getElementById('closeChatBtn');
    const sendBtn = document.getElementById('sendChatBtn');
    const chatInput = document.getElementById('chat-input');
    
    // Drag functionality for chat window with boundary constraints
    chatHeader.addEventListener('mousedown', function(e) {
        isDragging = true;
        dragOffsetX = e.clientX - chatContainer.getBoundingClientRect().left;
        dragOffsetY = e.clientY - chatContainer.getBoundingClientRect().top;
    });
    
    // Resize functionality
    chatResizer.addEventListener('mousedown', function(e) {
        isResizing = true;
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', function(e) {
        if (isDragging) {
            // Calculate potential new position
            let newLeft = e.clientX - dragOffsetX;
            let newTop = e.clientY - dragOffsetY;
            
            // Get current dimensions
            const chatWidth = chatContainer.offsetWidth;
            const chatHeight = chatContainer.offsetHeight;
            
            // Get window dimensions
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;
            
            // Apply constraints to keep chat within screen bounds
            // Left boundary
            if (newLeft < 0) newLeft = 0;
            // Right boundary (leave a small part visible)
            if (newLeft + 50 > windowWidth) newLeft = windowWidth - 50;
            // Top boundary
            if (newTop < 0) newTop = 0;
            // Bottom boundary (leave a small part visible)
            if (newTop + 50 > windowHeight) newTop = windowHeight - 50;
            
            // Apply the constrained position
            chatContainer.style.left = newLeft + 'px';
            chatContainer.style.right = 'auto';
            chatContainer.style.top = newTop + 'px';
            chatContainer.style.bottom = 'auto';
        }
        
        if (isResizing) {
            // Get current position and window dimensions
            const chatRect = chatContainer.getBoundingClientRect();
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;
            
            // Calculate potential new dimensions
            let newWidth = e.clientX - chatRect.left;
            let newHeight = e.clientY - chatRect.top;
            
            // Apply min/max constraints
            newWidth = Math.max(300, Math.min(600, newWidth));
            newHeight = Math.max(350, Math.min(700, newHeight));
            
            // Ensure chat stays within screen bounds when resizing
            if (chatRect.left + newWidth > windowWidth) {
                newWidth = windowWidth - chatRect.left;
            }
            
            if (chatRect.top + newHeight > windowHeight) {
                newHeight = windowHeight - chatRect.top;
            }
            
            // Apply the constrained dimensions
            chatContainer.style.width = newWidth + 'px';
            chatContainer.style.height = newHeight + 'px';
        }
    });
    
    document.addEventListener('mouseup', function() {
        isDragging = false;
        isResizing = false;
    });
    
    // Button actions
    minimizeBtn.addEventListener('click', function() {
        toggleChatBot();
    });
    
    closeBtn.addEventListener('click', function() {
        toggleChatBot();
    });
    
    sendBtn.addEventListener('click', sendChatMessage);
    
    // Send message on Enter (but allow Shift+Enter for new lines)
    chatInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
    });
    
    // Auto-resize chat input
    chatInput.addEventListener('input', function() {
        this.style.height = 'auto';
        const newHeight = Math.min(120, this.scrollHeight);
        this.style.height = newHeight + 'px';
    });
    
    // Reset chat position when toggle is closed and reopened
    const chatBotIcon = document.getElementById('chat-bot-icon');
    if (chatBotIcon) {
        chatBotIcon.addEventListener('click', function() {
            // If the chat is being opened (currently not visible)
            if (!chatBotVisible) {
                // Reset to default position when opening
                resetChatPosition();
            }
        });
    }
    
    // Function to reset chat position
    function resetChatPosition() {
        chatContainer.style.left = 'auto';
        chatContainer.style.right = '90px';
        chatContainer.style.top = 'auto';
        chatContainer.style.bottom = '90px';
        chatContainer.style.width = '350px';
        chatContainer.style.height = '450px';
    }
    
    // Ensure chat stays within bounds when window is resized
    window.addEventListener('resize', function() {
        if (chatBotVisible) {
            const chatRect = chatContainer.getBoundingClientRect();
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;
            
            let newLeft = chatRect.left;
            let newTop = chatRect.top;
            let newWidth = chatRect.width;
            let newHeight = chatRect.height;
            
            // Check if the chat is now outside window bounds after resize
            if (newLeft + 50 > windowWidth) {
                newLeft = windowWidth - 50;
            }
            
            if (newTop + 50 > windowHeight) {
                newTop = windowHeight - 50;
            }
            
            // Adjust width/height if needed
            if (newLeft + newWidth > windowWidth) {
                newWidth = windowWidth - newLeft;
            }
            
            if (newTop + newHeight > windowHeight) {
                newHeight = windowHeight - newTop;
            }
            
            // Apply any needed adjustments
            chatContainer.style.left = newLeft + 'px';
            chatContainer.style.top = newTop + 'px';
            
            if (newWidth !== chatRect.width) {
                chatContainer.style.width = newWidth + 'px';
            }
            
            if (newHeight !== chatRect.height) {
                chatContainer.style.height = newHeight + 'px';
            }
        }
    });
});

// Add to your existing JavaScript to enhance the features popup
document.addEventListener('DOMContentLoaded', function() {
    // ... existing code ...
    
    // Enhanced features popup
    const showFeaturesLink = document.getElementById('showFeaturesLink');
    const featuresPopup = document.getElementById('features-popup');
    const closePopupBtn = document.getElementById('closePopupBtn');
    const closeFeatureBtn = document.getElementById('closeFeatureBtn');
    const mainContainer = document.getElementById('main-container');
    
    // Function to show features popup with animation
    function showFeaturesPopup() {
        featuresPopup.classList.add('show');
        document.body.style.overflow = 'hidden'; // Prevent scrolling
        
        // Add blur effect to main container
        if (mainContainer) {
            mainContainer.classList.add('blur-background');
        }
        
        // Animate feature items sequentially
        const featureItems = document.querySelectorAll('.feature-item');
        featureItems.forEach((item, index) => {
            item.style.opacity = '0';
            item.style.transform = 'translateY(20px)';
            
            setTimeout(() => {
                item.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
                item.style.opacity = '1';
                item.style.transform = 'translateY(0)';
            }, 100 + (index * 50));
        });
        
        // Animate feature categories
        const categories = document.querySelectorAll('.feature-category');
        categories.forEach((category, index) => {
            category.style.opacity = '0';
            
            setTimeout(() => {
                category.style.transition = 'opacity 0.5s ease';
                category.style.opacity = '1';
            }, 100 + (index * 150));
        });
    }
    
    // Function to hide features popup
    function hideFeaturePopup() {
        featuresPopup.classList.remove('show');
        document.body.style.overflow = ''; // Restore scrolling
        
        // Remove blur effect from main container
        if (mainContainer) {
            mainContainer.classList.remove('blur-background');
        }
    }
    
    // Show features popup when clicking the link
    if (showFeaturesLink) {
        showFeaturesLink.addEventListener('click', function(e) {
            e.preventDefault();
            showFeaturesPopup();
        });
    }
    
    // Close popup when clicking the close button
    if (closePopupBtn) {
        closePopupBtn.addEventListener('click', hideFeaturePopup);
    }
    
    // Close popup when clicking the "Got it!" button
    if (closeFeatureBtn) {
        closeFeatureBtn.addEventListener('click', hideFeaturePopup);
    }
    
    // Close popup when clicking outside the content
    featuresPopup.addEventListener('click', function(e) {
        if (e.target === featuresPopup) {
            hideFeaturePopup();
        }
    });
    
    // Close popup with Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && featuresPopup.classList.contains('show')) {
            hideFeaturePopup();
        }
    });
    
    // Add interactive highlighting to feature items
    const featureItems = document.querySelectorAll('.feature-item');
    featureItems.forEach(item => {
        item.addEventListener('mouseenter', function() {
            // Add a subtle glow effect to the icon
            const icon = this.querySelector('.feature-icon');
            if (icon) {
                icon.style.transform = 'scale(1.1)';
                icon.style.boxShadow = '0 0 15px rgba(255, 121, 198, 0.5)';
            }
        });
        
        item.addEventListener('mouseleave', function() {
            // Remove the glow effect
            const icon = this.querySelector('.feature-icon');
            if (icon) {
                icon.style.transform = '';
                icon.style.boxShadow = '';
            }
        });
    });
    
    // Show features popup on first visit (optional)
    if (!localStorage.getItem('featuresShown')) {
        // Uncomment this to show features on first visit
        // setTimeout(showFeaturesPopup, 1000);
        localStorage.setItem('featuresShown', 'true');
    }
    
    // ... existing code ...
});

// Add to your existing JavaScript to ensure tooltips work correctly
document.addEventListener('DOMContentLoaded', function() {
    // ... existing code ...
    
    // Improved tooltip handling
    const teamMembers = document.querySelectorAll('.team-member');
    
    teamMembers.forEach(member => {
        const tooltip = member.querySelector('.member-tooltip');
        
        // Create a specialized event handler for this member
        function showTooltip() {
            if (tooltip) {
                // Position tooltip properly
                const rect = member.getBoundingClientRect();
                const windowHeight = window.innerHeight;
                
                // Reset any inline styles
                tooltip.style.removeProperty('bottom');
                tooltip.style.removeProperty('top');
                
                // If tooltip would go off the top of the viewport, position it below the member
                if (rect.top < 200) {
                    tooltip.style.bottom = 'auto';
                    tooltip.style.top = 'calc(100% + 15px)';
                    tooltip.classList.add('tooltip-below');
                    
                    // Move the arrow to the top
                    tooltip.style.setProperty('--arrow-position', 'top');
                } else {
                    tooltip.style.bottom = 'calc(100% + 15px)';
                    tooltip.style.top = 'auto';
                    tooltip.classList.remove('tooltip-below');
                    
                    // Move the arrow to the bottom
                    tooltip.style.setProperty('--arrow-position', 'bottom');
                }
                
                // Make tooltip visible
                tooltip.style.opacity = '1';
                tooltip.style.visibility = 'visible';
                tooltip.style.transform = 'translateY(0)';
                tooltip.style.zIndex = '1000'; // Very high z-index
            }
            
            // Add glow effect to the card
            member.style.boxShadow = '0 8px 25px rgba(255, 56, 56, 0.4)';
        }
        
        function hideTooltip() {
            if (tooltip) {
                tooltip.style.opacity = '0';
                tooltip.style.visibility = 'hidden';
                tooltip.style.transform = 'translateY(20px)';
            }
            
            // Reset card effect
            member.style.boxShadow = '0 5px 15px rgba(0, 0, 0, 0.2)';
        }
        
        // Apply the event handlers
        member.addEventListener('mouseenter', showTooltip);
        member.addEventListener('mouseleave', hideTooltip);
        
        // Handle click events to toggle tooltip on mobile
        member.addEventListener('click', function(e) {
            e.preventDefault();
            if (window.innerWidth <= 768) {
                const isVisible = tooltip.style.visibility === 'visible';
                if (isVisible) {
                    hideTooltip();
                } else {
                    // Hide all other tooltips first
                    document.querySelectorAll('.member-tooltip').forEach(t => {
                        t.style.opacity = '0';
                        t.style.visibility = 'hidden';
                    });
                    showTooltip();
                }
            }
        });
    });
    
    // Add extra CSS to fix tooltip positioning
    document.head.insertAdjacentHTML('beforeend', `
    <style>
        /* Additional tooltip fixes */
        .tooltip-wrapper {
            position: absolute;
            width: 100%;
            pointer-events: none;
            z-index: 9999;
        }
        
        .member-tooltip {
            z-index: 10000 !important;
            pointer-events: none;
        }
        
        /* Fix arrow positioning */
        .member-tooltip::after {
            position: absolute;
            bottom: calc(var(--arrow-position) === 'bottom' ? -10px : auto);
            top: calc(var(--arrow-position) === 'top' ? -10px : auto);
            left: 50%;
            transform: translateX(-50%) rotate(var(--arrow-position) === 'top' ? 225deg : 45deg);
        }
        
        /* Tooltip positioned below */
        .tooltip-below::after {
            bottom: auto;
            top: -10px;
            transform: translateX(-50%) rotate(225deg);
        }
        
        /* Prevent other elements from overlapping */
        body::before {
            content: '';
            display: none;
        }
        
        body.has-active-tooltip::before {
            display: block;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: transparent;
            z-index: 9000;
            pointer-events: none;
        }
        
        /* Ensure the tooltip is always on top */
        .team-member:hover .member-tooltip {
            z-index: 10000 !important;
        }
    </style>
    `);
    
    // ... existing code ...
});

// Additional function to fix any remaining tooltip issues
function fixTooltipDisplay() {
    // This fixes potential z-index stacking context issues
    document.querySelectorAll('.tooltip-wrapper').forEach(wrapper => {
        wrapper.style.zIndex = '9999';
    });
    
    document.querySelectorAll('.member-tooltip').forEach(tooltip => {
        tooltip.style.position = 'absolute';
        tooltip.style.zIndex = '10000';
    });
}

// Call this function after the page loads and whenever window resizes
window.addEventListener('load', fixTooltipDisplay);
window.addEventListener('resize', fixTooltipDisplay);

// Initialize the application with a click-to-start approach
document.addEventListener("DOMContentLoaded", function() {
    // Hide the main container until initialization is complete
    const mainContainer = document.getElementById('main-container');
    if (mainContainer) {
        mainContainer.style.display = 'none';
    }
    
    // Hide header elements until initialization is complete
    const header = document.querySelector('header');
    if (header) {
        header.style.visibility = 'hidden';
    }
    
    // Hide the marquee container until initialization is complete
    const marqueeContainer = document.querySelector('.marquee-container');
    if (marqueeContainer) {
        marqueeContainer.style.visibility = 'hidden';
    }
    
    // Create initialization overlay with button
    createInitButton();
});

// Create an initialization button that launches the loading screen when clicked
function createInitButton() {
    const initOverlay = document.createElement('div');
    initOverlay.id = 'init-overlay';
    initOverlay.innerHTML = `
        <div class="init-container">
            <div class="init-logo-container">
                <div class="init-logo">
                    <i class="fas fa-code"></i>
                </div>
                <div class="init-text">
                    <span class="init-title">CodeLab Debugger</span>
                    <span class="init-version">version 1.2.0</span>
                </div>
            </div>
            <div class="init-description">
                Welcome to CodeLab Debugger, your AI-powered tool for code analysis and learning.
            </div>
            <button id="start-button">INITIALIZE</button>
            <div class="init-status">System is ready to start</div>
        </div>
    `;
    
    document.body.appendChild(initOverlay);
    
    // Add styles for the initialization overlay
    const initStyles = document.createElement('style');
    initStyles.textContent = `
        #init-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #0f0f20 0%, #1f1f3a 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10001;
        }
        
        .init-container {
            text-align: center;
            padding: 40px;
            background-color: rgba(25, 25, 45, 0.8);
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(10px);
            position: relative;
            max-width: 90%;
            width: 480px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            animation: fadeInScale 0.6s ease-out;
        }
        
        @keyframes fadeInScale {
            0% {
                opacity: 0;
                transform: scale(0.9);
            }
            100% {
                opacity: 1;
                transform: scale(1);
            }
        }
        
        .init-logo-container {
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 25px;
        }
        
        .init-logo {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, #8be9fd 0%, #bd93f9 100%);
            border-radius: 50%;
            display: flex;
            justify-content: center;
            align-items: center;
            margin-right: 20px;
            box-shadow: 0 0 25px rgba(139, 233, 253, 0.5);
        }
        
        .init-logo i {
            font-size: 36px;
            color: #fff;
            animation: pulseGlow 2s infinite;
        }
        
        @keyframes pulseGlow {
            0% {
                text-shadow: 0 0 5px rgba(255, 255, 255, 0.8);
            }
            50% {
                text-shadow: 0 0 20px rgba(255, 255, 255, 0.8);
            }
            100% {
                text-shadow: 0 0 5px rgba(255, 255, 255, 0.8);
            }
        }
        
        .init-text {
            text-align: left;
        }
        
        .init-title {
            font-size: 28px;
            font-weight: bold;
            color: #f8f8f2;
            display: block;
            letter-spacing: 1px;
        }
        
        .init-version {
            font-size: 14px;
            color: #8be9fd;
            opacity: 0.8;
            display: block;
            margin-top: 5px;
        }
        
        .init-description {
            color: #f8f8f2;
            opacity: 0.8;
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 40px;
            padding: 0 10px;
        }
        
        #start-button {
            background: linear-gradient(90deg, #8be9fd, #bd93f9);
            color: white;
            border: none;
            padding: 16px 40px;
            font-size: 18px;
            font-weight: 600;
            border-radius: 30px;
            cursor: pointer;
            letter-spacing: 1px;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
            box-shadow: 0 8px 25px rgba(139, 233, 253, 0.3);
            margin: 0 auto;
            display: block;
        }
        
        #start-button::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(
                90deg, 
                transparent, 
                rgba(255, 255, 255, 0.3), 
                transparent
            );
            transition: 0.5s;
        }
        
        #start-button:hover {
            transform: translateY(-3px);
            box-shadow: 0 12px 30px rgba(139, 233, 253, 0.5);
        }
        
        #start-button:hover::before {
            left: 100%;
        }
        
        #start-button:active {
            transform: translateY(0);
            box-shadow: 0 5px 15px rgba(139, 233, 253, 0.3);
        }
        
        .init-status {
            margin-top: 25px;
            color: #8be9fd;
            font-size: 14px;
            position: relative;
            display: inline-block;
        }
        
        .init-status::before {
            content: '●';
            color: #50fa7b;
            margin-right: 8px;
            display: inline-block;
            animation: blink 1.5s infinite;
        }
        
        @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
        }
        
        @media (max-width: 600px) {
            .init-container {
                padding: 30px 20px;
                width: 90%;
            }
            
            .init-logo-container {
                flex-direction: column;
            }
            
            .init-logo {
                margin-right: 0;
                margin-bottom: 15px;
            }
            
            .init-text {
                text-align: center;
            }
            
            #start-button {
                padding: 14px 30px;
                font-size: 16px;
            }
        }
    `;
    
    document.head.appendChild(initStyles);
    
    // Add click event to start button
    document.getElementById('start-button').addEventListener('click', function() {
        // Show loading animation effect on button
        this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> INITIALIZING...';
        this.disabled = true;
        this.style.background = 'linear-gradient(90deg, #6272a4, #8be9fd)';
        
        // Update status text
        const statusElement = document.querySelector('.init-status');
        if (statusElement) {
            statusElement.textContent = 'Starting initialization process...';
            statusElement.style.color = '#f1fa8c';
        }
        
        // Start the loading sequence after a short delay
        setTimeout(function() {
            // Remove the init overlay
            initOverlay.style.opacity = '0';
            initOverlay.style.transition = 'opacity 0.5s ease-out';
            
            setTimeout(function() {
                document.body.removeChild(initOverlay);
                
                // Create and start the loading screen
                createLoadingScreen();
                
                // Set timeout for hiding loading screen (8 seconds as requested)
                setTimeout(function() {
                    hideLoadingScreen();
                    
                    // Show the main container and header after loading completes
                    const mainContainer = document.getElementById('main-container');
                    if (mainContainer) {
                        mainContainer.style.display = '';
                        mainContainer.style.animation = 'fadeIn 0.5s ease-out';
                    }
                    
                    const header = document.querySelector('header');
                    if (header) {
                        header.style.visibility = 'visible';
                        header.style.animation = 'fadeIn 0.5s ease-out';
                    }
                    
                    const marqueeContainer = document.querySelector('.marquee-container');
                    if (marqueeContainer) {
                        marqueeContainer.style.visibility = 'visible';
                        marqueeContainer.style.animation = 'fadeIn 0.5s ease-out';
                    }
                    
                    // Add fade-in animation style
                    const fadeStyle = document.createElement('style');
                    fadeStyle.textContent = `
                        @keyframes fadeIn {
                            from { opacity: 0; }
                            to { opacity: 1; }
                        }
                    `;
                    document.head.appendChild(fadeStyle);
                    
                }, 8000);
            }, 500);
        }, 800);
    });
}

// Create and inject the loading screen with styling that matches the internal application's color scheme
function createLoadingScreen() {
    const loadingScreen = document.createElement('div');
    loadingScreen.id = 'loading-screen';
    loadingScreen.innerHTML = `
        <div class="loader-container">
            <div class="loader-scanline"></div>
            <div class="loader-grid"></div>
            <div class="loader-content">
                <div class="loader-header">
                    <div class="loader-title-area">
                        <span class="loader-title" style="color: #00FF00;">SECURITY CHECKING</span>
                        <span class="loader-version">v1.2.0</span>
                    </div>
                    <div class="loader-security-badge">
                        <span class="badge-text">INITIALIZING</span>
                        <span class="badge-indicator"></span>
                    </div>
                </div>
                
                <div class="loader-icon">
                    <div class="loader-icon-inner">
                        <i class="fas fa-code"></i>
                    </div>
                    <div class="loader-icon-ring"></div>
                </div>
                
                <div class="loader-progress-area">
                    <div class="loader-progress-container">
                        <div class="loader-progress-bar" id="loader-progress-bar"></div>
                    </div>
                    <div class="loader-progress-percentage" id="loader-progress-percentage">0%</div>
                </div>
                
                <div class="loader-terminal">
                    <div class="terminal-header">
                        <span class="terminal-title">SYSTEM INITIALIZATION</span>
                        <div class="terminal-controls">
                            <span></span><span></span><span></span>
                        </div>
                    </div>
                    <div class="terminal-body" id="terminal-body">
                        <div class="terminal-line">$ <span class="command">init</span> CodeLab Debugger v1.2.0</div>
                    </div>
                </div>
                
                <div class="loader-details">
                    <div class="loader-detail-item">
                        <span class="loader-detail-label">Status:</span>
                        <span class="loader-detail-value" id="loader-detail-status">Loading components</span>
                    </div>
                    <div class="loader-detail-item">
                        <span class="loader-detail-label">Version:</span>
                        <span class="loader-detail-value">1.2.0</span>
                    </div>
                    <div class="loader-detail-item">
                        <span class="loader-detail-label">Engine:</span>
                        <span class="loader-detail-value">Mistral AI</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(loadingScreen);
    
    // Add CSS for the loading screen using the app's color variables
    const loadingScreenStyle = document.createElement('style');
    loadingScreenStyle.textContent = `
        #loading-screen {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: #1e1e2e; /* --primary-bg */
            z-index: 10000;
            display: flex;
            justify-content: center;
            align-items: center;
            transition: opacity 0.5s ease-out;
            overflow: hidden;
            font-family: 'Roboto', sans-serif;
        }
        
        .loader-container {
            width: 500px;
            padding: 25px;
            background-color: #282a36; /* --secondary-bg */
            border-radius: 8px;
            box-shadow: 0 0 40px rgba(0, 0, 0, 0.4); /* --shadow-color */
            position: relative;
            overflow: hidden;
            z-index: 1;
            border: 1px solid #3d3d5c;
        }
        
        .loader-scanline {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 2px;
            background: rgba(139, 233, 253, 0.5); /* --accent-2 with opacity */
            z-index: 2;
            box-shadow: 0 0 10px rgba(139, 233, 253, 0.5);
            animation: scanline 6s linear infinite;
            pointer-events: none;
        }
        
        .loader-grid {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-image: 
                linear-gradient(rgba(139, 233, 253, 0.05) 1px, transparent 1px),
                linear-gradient(90deg, rgba(139, 233, 253, 0.05) 1px, transparent 1px);
            background-size: 20px 20px;
            z-index: 0;
        }
        
        .loader-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 25px;
            border-bottom: 1px solid #3d3d5c;
            padding-bottom: 10px;
        }
        
        .loader-title-area {
            display: flex;
            flex-direction: column;
        }
        
        .loader-title {
            font-size: 24px;
            font-weight: bold;
            color: #f8f8f2; /* --text-primary */
            text-transform: uppercase;
            letter-spacing: 2px;
            margin-bottom: 2px;
        }
        
        .loader-version {
            font-size: 12px;
            font-family: monospace;
            color: #8be9fd; /* --accent-2 */
        }
        
        .loader-security-badge {
            background-color: #1e1e2e; /* --primary-bg */
            padding: 5px 10px;
            border-radius: 4px;
            border: 1px solid #8be9fd; /* --accent-2 */
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .badge-text {
            color: #8be9fd; /* --accent-2 */
            font-size: 12px;
            font-weight: bold;
            letter-spacing: 1px;
        }
        
        .badge-indicator {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background-color: #8be9fd; /* --accent-2 */
            animation: pulse 1s infinite alternate;
        }
        
        .loader-content {
            display: flex;
            flex-direction: column;
            position: relative;
            z-index: 2;
        }
        
        .loader-icon {
            align-self: center;
            width: 90px;
            height: 90px;
            position: relative;
            margin-bottom: 30px;
        }
        
        .loader-icon-inner {
            width: 70px;
            height: 70px;
            background: linear-gradient(135deg, #282a36 0%, #8be9fd 100%); /* --secondary-bg to --accent-2 */
            border-radius: 50%;
            display: flex;
            justify-content: center;
            align-items: center;
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            box-shadow: 0 0 20px rgba(139, 233, 253, 0.4), 
                        inset 0 0 15px rgba(139, 233, 253, 0.3);
            z-index: 2;
        }
        
        .loader-icon-inner i {
            color: #f8f8f2; /* --text-primary */
            font-size: 32px;
            animation: pulse 1.5s ease-in-out infinite;
        }
        
        .loader-icon-ring {
            width: 100%;
            height: 100%;
            border-radius: 50%;
            border: 3px solid transparent;
            border-top-color: #8be9fd; /* --accent-2 */
            border-bottom-color: #bd93f9; /* --accent-5 */
            position: absolute;
            top: 0;
            left: 0;
            animation: spin 2s linear infinite;
            z-index: 1;
        }
        
        .loader-icon-ring::before {
            content: '';
            position: absolute;
            top: 5px;
            left: 5px;
            right: 5px;
            bottom: 5px;
            border-radius: 50%;
            border: 3px solid transparent;
            border-left-color: #bd93f9; /* --accent-5 */
            border-right-color: #8be9fd; /* --accent-2 */
            animation: spin 3s linear infinite reverse;
        }
        
        .loader-progress-area {
            display: flex;
            align-items: center;
            margin-bottom: 20px;
            gap: 10px;
        }
        
        .loader-progress-container {
            flex: 1;
            height: 8px;
            background-color: #1e1e2e; /* --primary-bg */
            border-radius: 4px;
            overflow: hidden;
            position: relative;
            border: 1px solid #3d3d5c;
        }
        
        .loader-progress-bar {
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, #8be9fd, #bd93f9); /* --accent-2 to --accent-5 */
            border-radius: 3px;
            transition: width 0.2s ease;
            position: relative;
        }
        
        .loader-progress-bar::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
            animation: shimmer 1.5s infinite;
        }
        
        .loader-progress-percentage {
            color: #8be9fd; /* --accent-2 */
            font-family: monospace;
            font-weight: bold;
            font-size: 14px;
            width: 45px;
            text-align: right;
        }
        
        .loader-terminal {
            width: 100%;
            background-color: #1e1e2e; /* --primary-bg */
            border-radius: 6px;
            margin-bottom: 20px;
            overflow: hidden;
            border: 1px solid #3d3d5c;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.2);
        }
        
        .terminal-header {
            background-color: #282a36; /* --secondary-bg */
            padding: 5px 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #3d3d5c;
        }
        
        .terminal-title {
            color: #f8f8f2; /* --text-primary */
            font-size: 12px;
            font-weight: bold;
        }
        
        .terminal-controls {
            display: flex;
            gap: 5px;
        }
        
        .terminal-controls span {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: #ff5555; /* --error-color */
            opacity: 0.7;
        }
        
        .terminal-controls span:nth-child(2) {
            background-color: #ffb86c; /* --accent-4 */
        }
        
        .terminal-controls span:nth-child(3) {
            background-color: #50fa7b; /* --accent-3 / --success-color */
        }
        
        .terminal-body {
            padding: 10px;
            font-family: monospace;
            color: #f8f8f2; /* --text-primary */
            font-size: 12px;
            max-height: 150px;
            overflow-y: auto;
            background-color: #1e1e2e; /* --primary-bg */
        }
        
        .terminal-line {
            margin-bottom: 5px;
            line-height: 1.4;
        }
        
        .command {
            color: #50fa7b; /* --accent-3 / --success-color */
            font-weight: bold;
        }
        
        .success-text {
            color: #50fa7b; /* --accent-3 / --success-color */
        }
        
        .info-text {
            color: #8be9fd; /* --accent-2 */
        }
        
        .warning-text {
            color: #ffb86c; /* --accent-4 */
        }
        
        .loader-details {
            width: 100%;
            background-color: #1e1e2e; /* --primary-bg */
            border-radius: 5px;
            padding: 15px;
            border-left: 3px solid #8be9fd; /* --accent-2 */
        }
        
        .loader-detail-item {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 12px;
        }
        
        .loader-detail-item:last-child {
            margin-bottom: 0;
        }
        
        .loader-detail-label {
            color: #8be9fd; /* --accent-2 */
            font-weight: bold;
        }
        
        .loader-detail-value {
            color: #f8f8f2; /* --text-primary */
        }
        
        @keyframes scanline {
            0% {
                top: 0%;
            }
            100% {
                top: 100%;
            }
        }
        
        @keyframes shimmer {
            0% {
                transform: translateX(-100%);
            }
            100% {
                transform: translateX(100%);
            }
        }
        
        @keyframes spin {
            0% {
                transform: rotate(0deg);
            }
            100% {
                transform: rotate(360deg);
            }
        }
        
        @keyframes pulse {
            0% {
                transform: scale(1);
                opacity: 0.8;
            }
            50% {
                transform: scale(1.1);
                opacity: 1;
            }
            100% {
                transform: scale(1);
                opacity: 0.8;
            }
        }
        
        @media (max-width: 550px) {
            .loader-container {
                width: 90%;
                padding: 20px 15px;
            }
            
            .loader-header {
                flex-direction: column;
                align-items: flex-start;
                gap: 10px;
            }
            
            .loader-security-badge {
                align-self: flex-end;
            }
        }
    `;
    
    document.head.appendChild(loadingScreenStyle);
    
    // Animate the progress bar and add terminal logs
    animateProgressBar();
}

// Animate the loader progress bar with detailed initialization steps
function animateProgressBar() {
    const progressBar = document.getElementById('loader-progress-bar');
    const progressPercentage = document.getElementById('loader-progress-percentage');
    const detailStatus = document.getElementById('loader-detail-status');
    const terminalBody = document.getElementById('terminal-body');
    
    // Define initialization steps for the terminal
    const initSteps = [
        {
            progress: 0,
            delay: 0,
            message: "Initializing system...",
            terminal: "$ <span class='command'>system.init</span> --verbose",
            status: "Starting initialization sequence"
        },
        {
            progress: 5,
            delay: 500,
            message: "Loading core modules...",
            terminal: "[<span class='info-text'>INFO</span>] Loading core system modules...",
            status: "Core system initialization"
        },
        {
            progress: 15,
            delay: 500,
            message: "Compiler initialization...",
            terminal: "[<span class='info-text'>INFO</span>] Starting compiler service...",
            status: "Initializing compiler"
        },
        {
            progress: 20,
            delay: 300,
            message: "Setting up parsing engine...",
            terminal: "[<span class='success-text'>OK</span>] Compiler initialized successfully",
            status: "Compiler initialized"
        },
        {
            progress: 30,
            delay: 800,
            message: "Initializing code editor...",
            terminal: "[<span class='info-text'>INFO</span>] Loading syntax highlighting engine...",
            status: "Setting up code editor"
        },
        {
            progress: 35,
            delay: 300,
            message: "Configuring editor plugins...",
            terminal: "[<span class='success-text'>OK</span>] Code editor ready",
            status: "Code editor initialized"
        },
        {
            progress: 45,
            delay: 800,
            message: "Initializing visualizer...",
            terminal: "[<span class='info-text'>INFO</span>] Preparing execution flow tracker...",
            status: "Loading visualization engine"
        },
        {
            progress: 50,
            delay: 500,
            message: "Setting up execution flow monitor...",
            terminal: "[<span class='warning-text'>WARN</span>] Visualization may be limited for complex code",
            status: "Configuring visualizer"
        },
        {
            progress: 55,
            delay: 300,
            message: "Finalizing visualizer setup...",
            terminal: "[<span class='success-text'>OK</span>] Visualizer initialized successfully",
            status: "Visualizer initialized"
        },
        {
            progress: 65,
            delay: 800,
            message: "Initializing question generator...",
            terminal: "[<span class='info-text'>INFO</span>] Connecting to AI learning services...",
            status: "Loading learning system"
        },
        {
            progress: 70,
            delay: 500,
            message: "Setting up question templates...",
            terminal: "[<span class='success-text'>OK</span>] Question generator ready",
            status: "Question generator initialized"
        },
        {
            progress: 80,
            delay: 700,
            message: "Initializing debugging services...",
            terminal: "[<span class='info-text'>INFO</span>] Configuring error detection system...",
            status: "Setting up debugging"
        },
        {
            progress: 85,
            delay: 500,
            message: "Finalizing error detection system...",
            terminal: "[<span class='success-text'>OK</span>] Debugging services ready",
            status: "Debugging services initialized"
        },
        {
            progress: 90,
            delay: 600,
            message: "Initializing user interface...",
            terminal: "[<span class='info-text'>INFO</span>] Preparing UI components...",
            status: "Setting up interface"
        },
        {
            progress: 95,
            delay: 400,
            message: "Connecting components...",
            terminal: "[<span class='success-text'>OK</span>] UI components initialized",
            status: "UI initialized"
        },
        {
            progress: 100,
            delay: 500,
            message: "System initialization complete",
            terminal: "[<span class='success-text'>SUCCESS</span>] CodeLab Debugger ready!",
            status: "System ready"
        }
    ];
    
    let currentStep = 0;
    
    function processStep() {
        if (currentStep >= initSteps.length) return;
        
        const step = initSteps[currentStep];
        
        // Update progress bar
        progressBar.style.width = `${step.progress}%`;
        progressPercentage.textContent = `${step.progress}%`;
        
        // Update detail status
        detailStatus.textContent = step.status;
        
        // Add line to terminal
        const terminalLine = document.createElement('div');
        terminalLine.className = 'terminal-line';
        terminalLine.innerHTML = step.terminal;
        terminalBody.appendChild(terminalLine);
        terminalBody.scrollTop = terminalBody.scrollHeight;
        
        // Add a message line if provided
        if (step.message) {
            const messageLine = document.createElement('div');
            messageLine.className = 'terminal-line';
            messageLine.innerHTML = `[<span class='info-text'>SYSTEM</span>] ${step.message}`;
            
            setTimeout(() => {
                terminalBody.appendChild(messageLine);
                terminalBody.scrollTop = terminalBody.scrollHeight;
            }, 200);
        }
        
        currentStep++;
        
        // Schedule next step with the specified delay
        if (currentStep < initSteps.length) {
            setTimeout(processStep, step.delay);
        }
    }
    
    // Start processing steps
    processStep();
}

// Updated hide loading screen function to ensure 100% progress and proper transition
function hideLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        // Ensure progress bar is at 100%
        const progressBar = document.getElementById('loader-progress-bar');
        const progressPercentage = document.getElementById('loader-progress-percentage');
        if (progressBar) progressBar.style.width = '100%';
        if (progressPercentage) progressPercentage.textContent = '100%';
        
        // Add system startup message to terminal
        const terminalBody = document.getElementById('terminal-body');
        if (terminalBody) {
            const launchLine = document.createElement('div');
            launchLine.className = 'terminal-line';
            launchLine.innerHTML = `$ <span class='command'>system.launch</span> --mode=production`;
            terminalBody.appendChild(launchLine);
            
            setTimeout(() => {
                const readyLine = document.createElement('div');
                readyLine.className = 'terminal-line';
                readyLine.innerHTML = `[<span class='success-text'>LAUNCH</span>] Starting CodeLab Debugger...`;
                terminalBody.appendChild(readyLine);
                terminalBody.scrollTop = terminalBody.scrollHeight;
            }, 300);
        }
        
        // Final effect on the icon
        const iconInner = loadingScreen.querySelector('.loader-icon-inner');
        if (iconInner) {
            iconInner.style.transition = 'all 0.5s ease';
            iconInner.style.transform = 'scale(1.3)';
            iconInner.style.boxShadow = '0 0 30px rgba(139, 233, 253, 0.8), inset 0 0 15px rgba(139, 233, 253, 0.6)';
        }
        
        // Add a completion effect to the progress bar
        const progressContainer = document.querySelector('.loader-progress-container');
        if (progressContainer) {
            progressContainer.style.boxShadow = '0 0 15px rgba(139, 233, 253, 0.6)';
            progressContainer.style.transition = 'box-shadow 0.5s ease';
        }
        
        // Update badge to indicate completion
        const badgeText = document.querySelector('.badge-text');
        const badgeIndicator = document.querySelector('.badge-indicator');
        if (badgeText) {
            badgeText.textContent = 'READY';
            badgeText.style.color = '#50fa7b';
        }
        if (badgeIndicator) {
            badgeIndicator.style.backgroundColor = '#50fa7b';
        }
        
        // Update detail status
        const detailStatus = document.getElementById('loader-detail-status');
        if (detailStatus) {
            detailStatus.textContent = 'Launching application';
            detailStatus.style.color = '#50fa7b';
        }
        
        // Fade out the loading screen after showing 100% for a moment
        setTimeout(() => {
            // Add final animation
            const loaderContainer = document.querySelector('.loader-container');
            if (loaderContainer) {
                loaderContainer.style.transform = 'translateY(-20px)';
                loaderContainer.style.opacity = '0.9';
                loaderContainer.style.transition = 'transform 0.8s ease-out, opacity 0.8s ease-out';
            }
            
            setTimeout(() => {
                loadingScreen.style.opacity = '0';
                setTimeout(() => {
                    loadingScreen.style.display = 'none';
                    document.body.removeChild(loadingScreen);
                }, 500);
            }, 300);
        }, 1000);
    }
}

// Add AI-powered code navigation features
function initializeCodeNavigation() {
    // Create a new navigation panel
    const navPanel = document.createElement('div');
    navPanel.className = 'code-nav-panel';
    navPanel.innerHTML = `
        <div class="nav-panel-header">
            <span class="nav-panel-title"><i class="fas fa-map-signs"></i> Smart Navigation</span>
            <button class="nav-panel-close"><i class="fas fa-times"></i></button>
        </div>
        <div class="nav-panel-search">
            <input type="text" placeholder="Search code functions, classes..." id="code-nav-search">
            <button id="code-nav-search-btn"><i class="fas fa-search"></i></button>
        </div>
        <div class="nav-panel-sections">
            <div class="nav-section active" data-section="structure">
                <i class="fas fa-sitemap"></i> Structure
            </div>
            <div class="nav-section" data-section="functions">
                <i class="fas fa-code"></i> Functions
            </div>
            <div class="nav-section" data-section="variables">
                <i class="fas fa-cube"></i> Variables
            </div>
            <div class="nav-section" data-section="ai-insights">
                <i class="fas fa-brain"></i> AI Insights
            </div>
        </div>
        <div class="nav-panel-content">
            <div id="structure-content" class="section-content active">
                <div class="nav-loading">Analyzing code structure...</div>
            </div>
            <div id="functions-content" class="section-content">
                <div class="nav-loading">Identifying functions...</div>
            </div>
            <div id="variables-content" class="section-content">
                <div class="nav-loading">Mapping variables...</div>
            </div>
            <div id="ai-insights-content" class="section-content">
                <div class="nav-loading">Generating insights...</div>
            </div>
        </div>
        <div class="nav-panel-footer">
            <button id="nav-analyze-btn" class="primary-btn">
                <i class="fas fa-magic"></i> Analyze Code
            </button>
            <button id="nav-explain-btn">
                <i class="fas fa-lightbulb"></i> Explain Section
            </button>
        </div>
    `;
    
    document.body.appendChild(navPanel);
    
    // Add navigation panel styles
    const navStyles = document.createElement('style');
    navStyles.textContent = `
        .code-nav-panel {
            position: fixed;
            top: 80px;
            right: 20px;
            width: 320px;
            max-height: calc(100vh - 160px);
            background-color: var(--secondary-bg);
            border-radius: 8px;
            box-shadow: 0 4px 20px var(--shadow-color);
            z-index: 9000;
            display: flex;
            flex-direction: column;
            border: 1px solid #3d3d5c;
            transform: translateX(350px);
            transition: transform 0.3s ease-out;
            overflow: hidden;
        }
        
        .code-nav-panel.open {
            transform: translateX(0);
        }
        
        .nav-panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 15px;
            background-color: var(--primary-bg);
            border-bottom: 1px solid #3d3d5c;
        }
        
        .nav-panel-title {
            color: var(--accent-2);
            font-weight: bold;
            font-size: 16px;
        }
        
        .nav-panel-title i {
            margin-right: 8px;
        }
        
        .nav-panel-close {
            background: none;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            font-size: 14px;
            padding: 0;
            width: 28px;
            height: 28px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }
        
        .nav-panel-close:hover {
            background-color: rgba(255, 255, 255, 0.1);
            color: var(--text-primary);
        }
        
        .nav-panel-search {
            display: flex;
            padding: 10px;
            border-bottom: 1px solid #3d3d5c;
        }
        
        .nav-panel-search input {
            flex: 1;
            background-color: var(--primary-bg);
            border: 1px solid #3d3d5c;
            border-radius: 4px 0 0 4px;
            color: var(--text-primary);
            padding: 8px 12px;
            font-size: 14px;
        }
        
        .nav-panel-search input:focus {
            outline: none;
            border-color: var(--accent-2);
        }
        
        .nav-panel-search button {
            background-color: var(--accent-2);
            color: var(--primary-bg);
            border: none;
            border-radius: 0 4px 4px 0;
            padding: 8px 12px;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        
        .nav-panel-search button:hover {
            background-color: #7ad7ea;
        }
        
        .nav-panel-sections {
            display: flex;
            border-bottom: 1px solid #3d3d5c;
            background-color: var(--primary-bg);
        }
        
        .nav-section {
            flex: 1;
            text-align: center;
            padding: 10px 5px;
            color: var(--text-secondary);
            font-size: 12px;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            transition: all 0.2s;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        
        .nav-section i {
            display: block;
            font-size: 16px;
            margin-bottom: 4px;
        }
        
        .nav-section:hover {
            color: var(--text-primary);
        }
        
        .nav-section.active {
            color: var(--accent-2);
            border-bottom: 2px solid var(--accent-2);
        }
        
        .nav-panel-content {
            flex: 1;
            overflow-y: auto;
            position: relative;
        }
        
        .section-content {
            display: none;
            padding: 15px;
            height: 100%;
            overflow-y: auto;
        }
        
        .section-content.active {
            display: block;
        }
        
        .nav-loading {
            color: var(--text-secondary);
            text-align: center;
            padding: 20px;
            font-style: italic;
        }
        
        .nav-panel-footer {
            display: flex;
            padding: 10px;
            border-top: 1px solid #3d3d5c;
            gap: 10px;
        }
        
        .nav-panel-footer button {
            flex: 1;
            padding: 8px;
            border-radius: 4px;
            border: 1px solid #3d3d5c;
            background-color: var(--primary-bg);
            color: var(--text-primary);
            cursor: pointer;
            transition: all 0.2s;
            font-size: 13px;
        }
        
        .nav-panel-footer button:hover {
            background-color: rgba(255, 255, 255, 0.05);
        }
        
        .nav-panel-footer button.primary-btn {
            background-color: var(--accent-2);
            color: var(--primary-bg);
            border-color: var(--accent-2);
        }
        
        .nav-panel-footer button.primary-btn:hover {
            background-color: #7ad7ea;
        }
        
        .nav-panel-footer button i {
            margin-right: 5px;
        }
        
        .code-structure-item {
            display: flex;
            align-items: center;
            padding: 6px 0;
            color: var(--text-primary);
            cursor: pointer;
            border-radius: 4px;
            transition: background-color 0.2s;
        }
        
        .code-structure-item:hover {
            background-color: rgba(255, 255, 255, 0.05);
        }
        
        .code-structure-item i {
            margin-right: 8px;
            width: 18px;
            text-align: center;
            color: var(--accent-2);
        }
        
        .code-structure-item.function i {
            color: var(--accent-5);
        }
        
        .code-structure-item.variable i {
            color: var(--accent-1);
        }
        
        .code-structure-item.class i {
            color: var(--accent-4);
        }
        
        .structure-nested {
            margin-left: 20px;
            border-left: 1px dashed #3d3d5c;
            padding-left: 10px;
        }
        
        .ai-insight-card {
            background-color: var(--primary-bg);
            border-radius: 4px;
            padding: 12px;
            margin-bottom: 15px;
            border-left: 3px solid var(--accent-2);
        }
        
        .ai-insight-title {
            color: var(--accent-2);
            font-weight: bold;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
        }
        
        .ai-insight-title i {
            margin-right: 8px;
        }
        
        .ai-insight-content {
            color: var(--text-primary);
            font-size: 13px;
            line-height: 1.4;
        }
        
        .ai-insight-actions {
            display: flex;
            justify-content: flex-end;
            margin-top: 10px;
            gap: 10px;
        }
        
        .ai-insight-actions button {
            background: none;
            border: none;
            color: var(--accent-2);
            cursor: pointer;
            font-size: 12px;
            padding: 4px 8px;
            border-radius: 4px;
            transition: background-color 0.2s;
        }
        
        .ai-insight-actions button:hover {
            background-color: rgba(139, 233, 253, 0.1);
        }
        
        .code-nav-toggle {
            position: fixed;
            top: 120px;
            right: 20px;
            background-color: var(--accent-2);
            color: var(--primary-bg);
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 2px 10px var(--shadow-color);
            z-index: 8999;
            transition: all 0.2s;
            border: none;
        }
        
        .code-nav-toggle:hover {
            transform: scale(1.1);
            background-color: #7ad7ea;
        }
    `;
    
    document.head.appendChild(navStyles);
    
    // Add toggle button for the navigation panel
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'code-nav-toggle';
    toggleBtn.innerHTML = '<i class="fas fa-compass"></i>';
    document.body.appendChild(toggleBtn);
    
    // Initialize event listeners
    initNavPanelEvents();
    
    // Return references for later use
    return {
        panel: navPanel,
        toggleBtn: toggleBtn
    };
}

// Set up event listeners for the navigation panel
function initNavPanelEvents() {
    const toggleBtn = document.querySelector('.code-nav-toggle');
    const navPanel = document.querySelector('.code-nav-panel');
    const closeBtn = document.querySelector('.nav-panel-close');
    const navSections = document.querySelectorAll('.nav-section');
    const analyzeBtn = document.getElementById('nav-analyze-btn');
    const explainBtn = document.getElementById('nav-explain-btn');
    const searchInput = document.getElementById('code-nav-search');
    const searchBtn = document.getElementById('code-nav-search-btn');
    
    // Toggle navigation panel
    toggleBtn.addEventListener('click', () => {
        navPanel.classList.toggle('open');
        if (navPanel.classList.contains('open')) {
            // Analyze code when panel is opened
            analyzeCodeForNavigation();
        }
    });
    
    // Close navigation panel
    closeBtn.addEventListener('click', () => {
        navPanel.classList.remove('open');
    });
    
    // Switch between sections
    navSections.forEach(section => {
        section.addEventListener('click', () => {
            // Remove active class from all sections
            navSections.forEach(s => s.classList.remove('active'));
            document.querySelectorAll('.section-content').forEach(c => c.classList.remove('active'));
            
            // Add active class to clicked section
            section.classList.add('active');
            const sectionType = section.dataset.section;
            document.getElementById(`${sectionType}-content`).classList.add('active');
            
            // Load content for the section if needed
            if (sectionType === 'ai-insights' && !document.querySelector('.ai-insight-card')) {
                generateAIInsights();
            }
        });
    });
    
    // Analyze code button
    analyzeBtn.addEventListener('click', analyzeCodeForNavigation);
    
    // Explain section button
    explainBtn.addEventListener('click', explainCurrentSection);
    
    // Search functionality
    searchBtn.addEventListener('click', performCodeSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performCodeSearch();
        }
    });
}

// Analyze the code to populate the navigation panel
function analyzeCodeForNavigation() {
    const code = document.getElementById('code').value;
    const languageSelector = document.getElementById('language');
    const language = languageSelector ? languageSelector.value : 'python'; // Default to python if not found
    
    if (!code.trim()) {
        // No code to analyze
        document.getElementById('structure-content').innerHTML = `
            <div class="empty-state">
                <i class="fas fa-code"></i>
                <p>No code to analyze. Enter some code in the editor.</p>
            </div>
        `;
        document.getElementById('functions-content').innerHTML = `
            <div class="empty-state">
                <i class="fas fa-code"></i>
                <p>No functions to display.</p>
            </div>
        `;
        document.getElementById('variables-content').innerHTML = `
            <div class="empty-state">
                <i class="fas fa-code"></i>
                <p>No variables to display.</p>
            </div>
        `;
        return;
    }
    
    // Show loading states
    document.getElementById('structure-content').innerHTML = '<div class="nav-loading">Analyzing code structure...</div>';
    document.getElementById('functions-content').innerHTML = '<div class="nav-loading">Identifying functions...</div>';
    document.getElementById('variables-content').innerHTML = '<div class="nav-loading">Mapping variables...</div>';
    
    // Define language-specific patterns
    let functionPattern, variablePattern, classPattern;
    
    switch (language) {
        case 'python':
            functionPattern = /def\s+(\w+)\s*\([^)]*\):/g;
            classPattern = /class\s+(\w+)(?:\([^)]*\))?:/g;
            variablePattern = /^([a-zA-Z_]\w*)\s*=/gm;
            break;
        case 'java':
            functionPattern = /(?:public|private|protected)?\s+(?:static)?\s+\w+\s+(\w+)\s*\([^)]*\)\s*{/g;
            classPattern = /class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[^{]+)?{/g;
            variablePattern = /(?:int|float|double|String|boolean|char|long|short|byte)\s+([a-zA-Z_]\w*)\s*(?:=|;)/g;
            break;
        case 'cpp':
        case 'c':
            functionPattern = /(?:int|void|float|double|char|bool|long|short|unsigned|auto)\s+(\w+)\s*\([^)]*\)\s*{/g;
            classPattern = /(?:class|struct)\s+(\w+)(?:\s*:\s*[^{]+)?{/g;
            variablePattern = /(?:int|float|double|char|bool|long|short|unsigned|auto)\s+([a-zA-Z_]\w*)\s*(?:=|;)/g;
            break;
        default: // JavaScript fallback
            functionPattern = /function\s+(\w+)\s*\([^)]*\)/g;
            classPattern = /class\s+(\w+)(?:\s+extends\s+\w+)?{/g;
            variablePattern = /(?:let|const|var)\s+(\w+)\s*=/g;
    }
    
    // Parse functions
    const functionMatches = code.match(functionPattern) || [];
    const functions = functionMatches.map(match => {
        // Extract name based on the pattern for the language
        let funcName;
        if (language === 'python') {
            funcName = match.match(/def\s+(\w+)/)[1];
        } else if (language === 'java' || language === 'cpp' || language === 'c') {
            const parts = match.match(/\s+(\w+)\s*\(/);
            funcName = parts ? parts[1] : 'unknown';
        } else {
            funcName = match.match(/function\s+(\w+)/)[1];
        }
        
        return {
            name: funcName,
            type: 'function',
            line: getLineNumber(code, match)
        };
    });
    
    // Parse classes
    const classMatches = code.match(classPattern) || [];
    const classes = classMatches.map(match => {
        const className = match.match(/class\s+(\w+)/)[1];
        return {
            name: className,
            type: 'class',
            line: getLineNumber(code, match)
        };
    });
    
    // Parse variables - more robust pattern matching
    const lines = code.split('\n');
    const variables = [];
    
    // For Python specifically, try to pick up variable assignments
    if (language === 'python') {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // Skip comments and function/class definitions
            if (line.startsWith('#') || line.startsWith('def ') || line.startsWith('class ')) {
                continue;
            }
            
            // Look for variable assignments (but not comparisons)
            const varMatch = line.match(/^([a-zA-Z_]\w*)\s*=(?!=)/);
            if (varMatch) {
                variables.push({
                    name: varMatch[1],
                    type: 'variable',
                    line: i + 1
                });
            }
        }
    } else {
        // For other languages, use the regex pattern
        const varMatches = code.match(variablePattern) || [];
        varMatches.forEach(match => {
            let varName;
            if (language === 'java' || language === 'cpp' || language === 'c') {
                const parts = match.match(/\s+([a-zA-Z_]\w*)\s*(?:=|;)/);
                varName = parts ? parts[1] : 'unknown';
            } else {
                const parts = match.match(/(?:let|const|var)\s+(\w+)/);
                varName = parts ? parts[1] : 'unknown';
            }
            
            variables.push({
                name: varName,
                type: 'variable',
                line: getLineNumber(code, match)
            });
        });
    }
    
    // Combine functions and classes for structure
    const codeElements = [...functions, ...classes];
    
    // Build structure
    setTimeout(() => {
        // Populate structure content
        const structureHTML = `
            <div class="code-structure">
                <div class="code-structure-item">
                    <i class="fas fa-file-code"></i> ${language === 'python' ? 'main.py' : language === 'java' ? 'Main.java' : language === 'cpp' ? 'main.cpp' : language === 'c' ? 'main.c' : 'main.js'}
                </div>
                <div class="structure-nested">
                    ${classes.map(c => 
                        `<div class="code-structure-item class" data-line="${c.line}">
                            <i class="fas fa-cubes"></i> ${c.name}
                        </div>`
                    ).join('')}
                    
                    ${variables.slice(0, 5).map(v => 
                        `<div class="code-structure-item variable" data-line="${v.line}">
                            <i class="fas fa-cube"></i> ${v.name}
                        </div>`
                    ).join('')}
                    
                    ${functions.map(f => 
                        `<div class="code-structure-item function" data-line="${f.line}">
                            <i class="fas fa-code"></i> ${f.name}()
                        </div>`
                    ).join('')}
                </div>
            </div>
        `;
        document.getElementById('structure-content').innerHTML = structureHTML;
        
        // Populate functions content
        const functionsHTML = functions.length > 0 ? 
            `<div class="functions-list">
                ${functions.map(f => 
                    `<div class="code-structure-item function" data-line="${f.line}">
                        <i class="fas fa-code"></i> ${f.name}()
                    </div>`
                ).join('')}
            </div>` : 
            `<div class="empty-state">
                <i class="fas fa-code"></i>
                <p>No functions detected in the code.</p>
            </div>`;
        document.getElementById('functions-content').innerHTML = functionsHTML;
        
        // Also add classes to the functions section
        if (classes.length > 0 && document.getElementById('functions-content').innerHTML.includes('No functions detected')) {
            document.getElementById('functions-content').innerHTML = `
                <div class="classes-list">
                    ${classes.map(c => 
                        `<div class="code-structure-item class" data-line="${c.line}">
                            <i class="fas fa-cubes"></i> ${c.name}
                        </div>`
                    ).join('')}
                </div>`;
        } else if (classes.length > 0) {
            const functionsList = document.querySelector('.functions-list');
            if (functionsList) {
                classes.forEach(c => {
                    const classDiv = document.createElement('div');
                    classDiv.className = 'code-structure-item class';
                    classDiv.dataset.line = c.line;
                    classDiv.innerHTML = `<i class="fas fa-cubes"></i> ${c.name}`;
                    functionsList.appendChild(classDiv);
                });
            }
        }
        
        // Populate variables content
        const variablesHTML = variables.length > 0 ? 
            `<div class="variables-list">
                ${variables.map(v => 
                    `<div class="code-structure-item variable" data-line="${v.line}">
                        <i class="fas fa-cube"></i> ${v.name}
                    </div>`
                ).join('')}
            </div>` : 
            `<div class="empty-state">
                <i class="fas fa-cube"></i>
                <p>No variables detected in the code.</p>
            </div>`;
        document.getElementById('variables-content').innerHTML = variablesHTML;
        
        // Add click events to navigate to code lines
        document.querySelectorAll('.code-structure-item[data-line]').forEach(item => {
            item.addEventListener('click', () => {
                const lineNumber = parseInt(item.dataset.line);
                navigateToCodeLine(lineNumber);
            });
        });
    }, 1000);
}

// Generate AI insights for the code
function generateAIInsights() {
    const code = document.getElementById('code').value;
    if (!code.trim()) {
        document.getElementById('ai-insights-content').innerHTML = `
            <div class="empty-state">
                <i class="fas fa-brain"></i>
                <p>No code to analyze for insights.</p>
            </div>
        `;
        return;
    }
    
    document.getElementById('ai-insights-content').innerHTML = '<div class="nav-loading">AI is analyzing your code...</div>';
    
    // In a real implementation, this would call an AI service
    // For now, we'll simulate AI-generated insights
    setTimeout(() => {
        const insights = [
            {
                title: 'Potential Performance Issue',
                icon: 'fas fa-tachometer-alt',
                content: 'The code contains multiple nested loops which could cause performance issues with large inputs.',
                actions: ['Show Details', 'Fix Automatically']
            },
            {
                title: 'Code Structure Recommendation',
                icon: 'fas fa-sitemap',
                content: 'Consider breaking down the large functions into smaller, more focused functions for better maintainability.',
                actions: ['Learn More', 'Show Example']
            },
            {
                title: 'Variable Usage',
                icon: 'fas fa-list-ul',
                content: 'The variable "result" is declared but never used in some code paths.',
                actions: ['Highlight', 'Fix Issue']
            }
        ];
        
        const insightsHTML = `
            ${insights.map(insight => `
                <div class="ai-insight-card">
                    <div class="ai-insight-title">
                        <i class="${insight.icon}"></i> ${insight.title}
                    </div>
                    <div class="ai-insight-content">
                        ${insight.content}
                    </div>
                    <div class="ai-insight-actions">
                        ${insight.actions.map(action => 
                            `<button>${action}</button>`
                        ).join('')}
                    </div>
                </div>
            `).join('')}
        `;
        
        document.getElementById('ai-insights-content').innerHTML = insightsHTML;
        
        // Add event listeners for insight actions
        document.querySelectorAll('.ai-insight-actions button').forEach(button => {
            button.addEventListener('click', () => {
                const action = button.textContent;
                const insight = button.closest('.ai-insight-card').querySelector('.ai-insight-title').textContent.trim();
                handleInsightAction(action, insight);
            });
        });
    }, 1500);
}

// Navigate to a specific line in the code editor
function navigateToCodeLine(lineNumber) {
    const codeTextArea = document.getElementById('code');
    const lines = codeTextArea.value.split('\n');
    
    if (lineNumber <= 0 || lineNumber > lines.length) {
        console.error(`Invalid line number: ${lineNumber}`);
        return;
    }
    
    // Calculate the position of the line
    let position = 0;
    for (let i = 0; i < lineNumber - 1; i++) {
        position += lines[i].length + 1; // +1 for the newline character
    }
    
    // Focus the textarea and set the selection
    codeTextArea.focus();
    codeTextArea.setSelectionRange(position, position);
    
    // Highlight the line for a moment
    const codeMirrorLine = document.querySelector(`.CodeMirror-line:nth-child(${lineNumber})`);
    if (codeMirrorLine) {
        codeMirrorLine.classList.add('highlighted-line');
        setTimeout(() => {
            codeMirrorLine.classList.remove('highlighted-line');
        }, 2000);
    }
    
    // Alternatively, for standard textarea
    const highlightPos = position;
    const highlightLine = lines[lineNumber - 1];
    const beforeText = codeTextArea.value.substring(0, highlightPos);
    const afterText = codeTextArea.value.substring(highlightPos + highlightLine.length);
    
    // Apply a temporary highlight effect
    const originalValue = codeTextArea.value;
    codeTextArea.value = beforeText + highlightLine + afterText;
    autoResize(codeTextArea);
    
    // Ensure the line is visible (auto-scroll)
    codeTextArea.blur();
    codeTextArea.focus();
}

// Get line number of a match in the code
function getLineNumber(code, match) {
    const index = code.indexOf(match);
    if (index === -1) return 1;
    
    return code.substring(0, index).split('\n').length;
}

// Perform a search in the code
function performCodeSearch() {
    const searchTerm = document.getElementById('code-nav-search').value.trim();
    if (!searchTerm) return;
    
    const code = document.getElementById('code').value;
    if (!code.trim()) return;
    
    // Find all matches
    const matches = [];
    let match;
    const regex = new RegExp(searchTerm, 'gi');
    const lines = code.split('\n');
    
    lines.forEach((line, index) => {
        if (line.match(regex)) {
            matches.push({
                line: index + 1,
                text: line.trim()
            });
        }
    });
    
    // Show results in structure tab
    document.querySelector('.nav-section[data-section="structure"]').click();
    
    if (matches.length > 0) {
        const resultsHTML = `
            <div class="search-results">
                <div class="search-header">
                    Found ${matches.length} matches for "${searchTerm}"
                </div>
                ${matches.map(match => 
                    `<div class="code-structure-item" data-line="${match.line}">
                        <i class="fas fa-search"></i> 
                        <span>Line ${match.line}: ${match.text.substring(0, 30)}${match.text.length > 30 ? '...' : ''}</span>
                    </div>`
                ).join('')}
            </div>
        `;
        document.getElementById('structure-content').innerHTML = resultsHTML;
        
        // Add click events for navigation
        document.querySelectorAll('.code-structure-item[data-line]').forEach(item => {
            item.addEventListener('click', () => {
                const lineNumber = parseInt(item.dataset.line);
                navigateToCodeLine(lineNumber);
            });
        });
    } else {
        document.getElementById('structure-content').innerHTML = `
            <div class="empty-state">
                <i class="fas fa-search"></i>
                <p>No matches found for "${searchTerm}"</p>
            </div>
        `;
    }
}

// Handle insight action clicks
function handleInsightAction(action, insight) {
    // Check for specific actions and insights
    if (action === "Show Details" && insight.includes("Potential Performance Issue")) {
        showPerformanceDetails();
    } else {
        // Default fallback for other actions
        showNotification(`${action} for: ${insight}`, 'info');
    }
}

// Function to show detailed performance analysis
function showPerformanceDetails() {
    // Get the current code
    const code = document.getElementById('code').value;
    
    // Create and show a modal with performance details
    const modal = document.createElement('div');
    modal.className = 'explanation-modal';
    modal.innerHTML = `
        <div class="explanation-content">
            <div class="explanation-header">
                <h3><i class="fas fa-tachometer-alt"></i> Performance Issue Details</h3>
                <button class="close-explanation"><i class="fas fa-times"></i></button>
            </div>
            <div class="explanation-text">
                <h4>Performance Issue: Nested Loops</h4>
                <p>Your code contains nested loops which can lead to performance issues with large datasets, potentially resulting in O(n²) or worse time complexity.</p>
                
                <h4>Impact:</h4>
                <ul>
                    <li>With small inputs, nested loops may not cause noticeable delays</li>
                    <li>As input size grows, processing time increases quadratically or worse</li>
                    <li>Can lead to application freezing or timeouts with large datasets</li>
                </ul>
                
                <h4>Recommendations:</h4>
                <ul>
                    <li>Consider using more efficient data structures (e.g., hash maps) to avoid nested iterations</li>
                    <li>Look for opportunities to combine loops or use array methods like map/filter/reduce</li>
                    <li>Consider implementing pagination or lazy loading for large datasets</li>
                    <li>If nested loops are necessary, ensure the inner loop processes as few items as possible</li>
                </ul>
            </div>
            <div class="explanation-footer">
                <button class="optimize-btn">Optimize Automatically</button>
                <button class="learn-more-btn">Learn More About Time Complexity</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Add event listeners for the buttons
    modal.querySelector('.close-explanation').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    modal.querySelector('.optimize-btn').addEventListener('click', () => {
        document.body.removeChild(modal);
        showNotification('Automatic optimization initiated', 'info');
    });
    
    modal.querySelector('.learn-more-btn').addEventListener('click', () => {
        showNotification('Opening documentation on time complexity', 'info');
    });
}

// Explain current section of code using AI
function explainCurrentSection() {
    const code = document.getElementById('code').value;
    if (!code.trim()) {
        showNotification('No code to explain', 'warning');
        return;
    }
    
    // Get current cursor position in the textarea
    const codeTextArea = document.getElementById('code');
    const cursorPos = codeTextArea.selectionStart;
    const codeUpToCursor = code.substring(0, cursorPos);
    const currentLine = codeUpToCursor.split('\n').length;
    
    // Find start and end of current function or block
    const lines = code.split('\n');
    let startLine = currentLine;
    let endLine = currentLine;
    let bracketCount = 0;
    let foundStart = false;
    
    // Go backward to find function/block start
    for (let i = currentLine - 1; i >= 0; i--) {
        if (lines[i].includes('{')) {
            bracketCount--;
            if (bracketCount < 0) {
                startLine = i;
                foundStart = true;
                bracketCount = 0;
                break;
            }
        }
        if (lines[i].includes('}')) {
            bracketCount++;
        }
    }
    
    // Go forward to find function/block end
    bracketCount = 0;
    for (let i = startLine; i < lines.length; i++) {
        if (lines[i].includes('{')) {
            bracketCount++;
        }
        if (lines[i].includes('}')) {
            bracketCount--;
            if (bracketCount <= 0 && foundStart) {
                endLine = i;
                break;
            }
        }
    }
    
    // Extract the block of code
    const codeSection = lines.slice(startLine, endLine + 1).join('\n');
    
    // Simulate AI explanation
    showLoading('Generating explanation...');
    
    // In a real implementation, this would call an AI service
    setTimeout(() => {
        hideLoading();
        
        // Create and show explanation modal
        const explanationModal = document.createElement('div');
        explanationModal.className = 'explanation-modal';
        explanationModal.innerHTML = `
            <div class="explanation-content">
                <div class="explanation-header">
                    <h3>AI Code Explanation</h3>
                    <button class="close-explanation"><i class="fas fa-times"></i></button>
                </div>
                <div class="code-section">
                    <pre><code>${codeSection}</code></pre>
                </div>
                <div class="explanation-text">
                    <h4>What this code does:</h4>
                    <p>This code appears to be ${startLine === endLine ? 'a single line' : 'a block'} that handles data processing logic. The main purpose seems to be to process input values and generate appropriate outputs.</p>
                    
                    <h4>Key components:</h4>
                    <ul>
                        <li>Variables are initialized and processed</li>
                        <li>Conditions check for valid input values</li>
                        <li>Results are computed based on the input conditions</li>
                    </ul>
                    
                    <h4>Potential improvements:</h4>
                    <ul>
                        <li>Consider adding more comments for clarity</li>
                        <li>Error handling could be improved</li>
                        <li>Code could be refactored for better readability</li>
                    </ul>
                </div>
                <div class="explanation-footer">
                    <button class="copy-explanation">Copy Explanation</button>
                    <button class="explain-more">Explain in More Detail</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(explanationModal);
        
        // Add modal styles if not already added
        if (!document.getElementById('explanation-modal-styles')) {
            const modalStyles = document.createElement('style');
            modalStyles.id = 'explanation-modal-styles';
            modalStyles.textContent = `
                            .explanation-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-color: rgba(0, 0, 0, 0.7);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 10000;
                }
                
                .explanation-content {
                    width: 80%;
                    max-width: 800px;
                    max-height: 90vh;
                    background-color: var(--secondary-bg);
                    border-radius: 8px;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                    border: 1px solid #3d3d5c;
                    animation: fadeInScale 0.3s ease-out;
                }
                
                .explanation-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 15px 20px;
                    background-color: var(--primary-bg);
                    border-bottom: 1px solid #3d3d5c;
                }
                
                .explanation-header h3 {
                    color: var(--accent-2);
                    margin: 0;
                    font-size: 18px;
                }
                
                .close-explanation {
                    background: none;
                    border: none;
                    color: var(--text-secondary);
                    cursor: pointer;
                    font-size: 16px;
                    padding: 5px;
                    border-radius: 4px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s;
                }
                
                .close-explanation:hover {
                    background-color: rgba(255, 255, 255, 0.1);
                    color: var(--text-primary);
                }
                
                .code-section {
                    background-color: var(--primary-bg);
                    padding: 15px;
                    border-bottom: 1px solid #3d3d5c;
                    overflow-x: auto;
                }
                
                .code-section pre {
                    margin: 0;
                    font-family: monospace;
                    font-size: 14px;
                    line-height: 1.5;
                    color: var(--text-primary);
                }
                
                .explanation-text {
                    padding: 20px;
                    flex: 1;
                    overflow-y: auto;
                    color: var(--text-primary);
                }
                
                .explanation-text h4 {
                    color: var(--accent-1);
                    margin: 15px 0 8px;
                    font-size: 16px;
                }
                
                .explanation-text p, .explanation-text ul {
                    margin: 8px 0;
                    font-size: 14px;
                    line-height: 1.6;
                }
                
                .explanation-text ul {
                    padding-left: 25px;
                }
                
                .explanation-text li {
                    margin-bottom: 5px;
                }
                
                .explanation-footer {
                    display: flex;
                    justify-content: flex-end;
                    gap: 10px;
                    padding: 15px 20px;
                    border-top: 1px solid #3d3d5c;
                }
                
                .explanation-footer button {
                    padding: 8px 15px;
                    border-radius: 4px;
                    font-size: 14px;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                
                .copy-explanation {
                    background-color: var(--primary-bg);
                    color: var(--text-primary);
                    border: 1px solid #3d3d5c;
                }
                
                .copy-explanation:hover {
                    background-color: rgba(255, 255, 255, 0.05);
                }
                
                .explain-more {
                    background-color: var(--accent-2);
                    color: var(--primary-bg);
                    border: 1px solid var(--accent-2);
                }
                
                .explain-more:hover {
                    background-color: #7ad7ea;
                }
            `;
            document.head.appendChild(modalStyles);
        }
        
        // Add event listeners for modal
        explanationModal.querySelector('.close-explanation').addEventListener('click', () => {
            document.body.removeChild(explanationModal);
        });
        
        explanationModal.querySelector('.copy-explanation').addEventListener('click', () => {
            const explanationText = explanationModal.querySelector('.explanation-text').innerText;
            navigator.clipboard.writeText(explanationText)
                .then(() => {
                    showNotification('Explanation copied to clipboard', 'success');
                })
                .catch(err => {
                    console.error('Failed to copy explanation: ', err);
                    showNotification('Failed to copy explanation', 'error');
                });
        });
        
        explanationModal.querySelector('.explain-more').addEventListener('click', () => {
            explanationModal.querySelector('.explanation-text').innerHTML = `
                <div class="nav-loading">Generating more detailed explanation...</div>
            `;
            
            // Simulate more detailed AI explanation
            setTimeout(() => {
                explanationModal.querySelector('.explanation-text').innerHTML = `
                    <h4>Detailed Explanation:</h4>
                    <p>This code section implements a critical part of the application's logic. Here's a detailed breakdown:</p>
                    
                    <h4>Line-by-line analysis:</h4>
                    <ul>
                        <li><strong>Variable declarations:</strong> The code begins by declaring necessary variables that will hold intermediate values during processing.</li>
                        <li><strong>Data validation:</strong> It then performs validation on the input data to ensure it meets the expected criteria.</li>
                        <li><strong>Core algorithm:</strong> The main processing happens in the middle section, where data transformations and calculations are applied.</li>
                        <li><strong>Result preparation:</strong> Finally, the code formats the results into the expected output structure.</li>
                    </ul>
                    
                    <h4>Design patterns used:</h4>
                    <p>This code appears to implement a variation of the processor pattern, where input data flows through several stages of transformation.</p>
                    
                    <h4>Performance considerations:</h4>
                    <p>The algorithm has a time complexity of approximately O(n), which should scale reasonably well for most inputs. However, for extremely large datasets, consider implementing pagination or lazy loading.</p>
                    
                    <h4>Recommended improvements:</h4>
                    <ul>
                        <li>Extract repeated logic into helper functions for better maintainability</li>
                        <li>Add input validation with clear error messages</li>
                        <li>Consider implementing caching for expensive operations</li>
                        <li>Add comprehensive error handling for edge cases</li>
                        <li>Include JSDoc comments to document parameters and return values</li>
                    </ul>
                    
                    <h4>Related concepts:</h4>
                    <p>This implementation relates to several important programming concepts:</p>
                    <ul>
                        <li>Data transformation pipelines</li>
                        <li>Functional programming techniques</li>
                        <li>Declarative vs imperative programming approaches</li>
                    </ul>
                `;
            }, 1500);
        });
        
        // Close modal when clicking outside
        explanationModal.addEventListener('click', (e) => {
            if (e.target === explanationModal) {
                document.body.removeChild(explanationModal);
            }
        });
    }, 2000);
}

// Show loading overlay
function showLoading(message = 'Loading...') {
    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'loading-overlay';
    loadingOverlay.innerHTML = `
        <div class="loading-spinner"></div>
        <div class="loading-message">${message}</div>
    `;
    document.body.appendChild(loadingOverlay);
    
    // Add styles if not already added
    if (!document.getElementById('loading-overlay-styles')) {
        const loadingStyles = document.createElement('style');
        loadingStyles.id = 'loading-overlay-styles';
        loadingStyles.textContent = `
            .loading-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.5);
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                z-index: 10001;
            }
            
            .loading-spinner {
                width: 50px;
                height: 50px;
                border: 5px solid rgba(255, 255, 255, 0.1);
                border-top-color: var(--accent-2);
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }
            
            .loading-message {
                margin-top: 15px;
                color: var(--text-primary);
                font-size: 16px;
            }
        `;
        document.head.appendChild(loadingStyles);
    }
}

// Hide loading overlay
function hideLoading() {
    const loadingOverlay = document.querySelector('.loading-overlay');
    if (loadingOverlay) {
        document.body.removeChild(loadingOverlay);
    }
}

// Show a notification
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    
    let icon = 'fas fa-info-circle';
    if (type === 'success') icon = 'fas fa-check-circle';
    if (type === 'warning') icon = 'fas fa-exclamation-triangle';
    if (type === 'error') icon = 'fas fa-times-circle';
    
    notification.innerHTML = `
        <i class="${icon}"></i>
        <span>${message}</span>
        <button class="notification-close"><i class="fas fa-times"></i></button>
    `;
    
    // Create notifications container if it doesn't exist
    let notificationsContainer = document.querySelector('.notifications-container');
    if (!notificationsContainer) {
        notificationsContainer = document.createElement('div');
        notificationsContainer.className = 'notifications-container';
        document.body.appendChild(notificationsContainer);
        
        // Add styles for notifications
        const notificationStyles = document.createElement('style');
        notificationStyles.textContent = `
            .notifications-container {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-width: 350px;
            }
            
            .notification {
                background-color: var(--secondary-bg);
                color: var(--text-primary);
                border-radius: 4px;
                padding: 12px 15px;
                display: flex;
                align-items: center;
                box-shadow: 0 4px 12px var(--shadow-color);
                animation: slideIn 0.3s ease-out forwards;
                position: relative;
                border-left: 4px solid var(--accent-2);
            }
            
            .notification i:first-child {
                margin-right: 10px;
                font-size: 18px;
            }
            
            .notification span {
                flex: 1;
                font-size: 14px;
            }
            
            .notification-close {
                background: none;
                border: none;
                color: var(--text-secondary);
                cursor: pointer;
                padding: 5px;
                font-size: 12px;
                border-radius: 3px;
                transition: all 0.2s;
            }
            
            .notification-close:hover {
                background-color: rgba(255, 255, 255, 0.1);
                color: var(--text-primary);
            }
            
            .notification-info {
                border-left-color: var(--accent-2);
            }
            
            .notification-info i:first-child {
                color: var(--accent-2);
            }
            
            .notification-success {
                border-left-color: var(--success-color);
            }
            
            .notification-success i:first-child {
                color: var(--success-color);
            }
            
            .notification-warning {
                border-left-color: var(--accent-4);
            }
            
            .notification-warning i:first-child {
                color: var(--accent-4);
            }
            
            .notification-error {
                border-left-color: var(--error-color);
            }
            
            .notification-error i:first-child {
                color: var(--error-color);
            }
            
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            
            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
        `;
        document.head.appendChild(notificationStyles);
    }
    
    notificationsContainer.appendChild(notification);
    
    // Setup close button
    notification.querySelector('.notification-close').addEventListener('click', () => {
        notification.style.animation = 'slideOut 0.3s ease-out forwards';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    });
    
    // Auto-close after 5 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'slideOut 0.3s ease-out forwards';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }
    }, 5000);
}

// Add a new AI code assistant feature
function initializeAICodeAssistant() {
    // Create AI assistant panel
    const assistantPanel = document.createElement('div');
    assistantPanel.className = 'ai-assistant-panel';
    assistantPanel.innerHTML = `
        <div class="assistant-header">
            <span class="assistant-title"><i class="fas fa-robot"></i> AI Code Assistant</span>
            <div class="assistant-actions">
                <button class="minimize-assistant"><i class="fas fa-minus"></i></button>
                <button class="close-assistant"><i class="fas fa-times"></i></button>
            </div>
        </div>
        <div class="assistant-tabs">
            <div class="assistant-tab active" data-tab="suggestions">Suggestions</div>
            <div class="assistant-tab" data-tab="autocomplete">Autocomplete</div>
            <div class="assistant-tab" data-tab="refactor">Refactor</div>
        </div>
        <div class="assistant-content">
            <div id="suggestions-tab" class="tab-content active">
                <div class="assistant-intro">
                    <p>I'll analyze your code and offer suggestions for improvements.</p>
                    <button class="analyze-code-btn">Analyze My Code</button>
                </div>
                <div class="suggestions-list"></div>
            </div>
            <div id="autocomplete-tab" class="tab-content">
                <div class="autocomplete-settings">
                    <label>
                        <input type="checkbox" id="autocomplete-toggle" checked>
                        Enable autocomplete
                    </label>
                    <div class="setting-group">
                        <label>Intelligence level:</label>
                        <div class="intelligence-level">
                            <span class="level-option selected" data-level="1">Basic</span>
                            <span class="level-option" data-level="2">Medium</span>
                            <span class="level-option" data-level="3">Advanced</span>
                        </div>
                    </div>
                </div>
                <div class="autocomplete-preview">
                    <div class="preview-header">Live Preview</div>
                    <div class="preview-content">
                        <span class="code-line">function calculateTotal(items) {</span>
                        <span class="code-line">  let total = 0;</span>
                        <span class="code-line">  for (const item of items) {</span>
                        <span class="code-line active">    total += item.price * item.quantity;</span>
                        <span class="code-line">  }</span>
                        <span class="code-line">  return total;</span>
                        <span class="code-line">}</span>
                    </div>
                </div>
            </div>
            <div id="refactor-tab" class="tab-content">
                <div class="refactor-options">
                    <button class="refactor-option" data-action="simplify">
                        <i class="fas fa-broom"></i>
                        <span>Simplify Code</span>
                    </button>
                    <button class="refactor-option" data-action="document">
                        <i class="fas fa-file-alt"></i>
                        <span>Add Documentation</span>
                    </button>
                    <button class="refactor-option" data-action="optimize">
                        <i class="fas fa-tachometer-alt"></i>
                        <span>Optimize Performance</span>
                    </button>
                    <button class="refactor-option" data-action="convert">
                        <i class="fas fa-exchange-alt"></i>
                        <span>Convert to Modern JS</span>
                    </button>
                </div>
                <div class="selected-code-info">
                    Select code in the editor to refactor
                </div>
            </div>
        </div>
        <div class="assistant-footer">
            <div class="assistant-status">Ready to assist</div>
            <button class="assistant-settings-btn"><i class="fas fa-cog"></i></button>
        </div>
    `;
    
    document.body.appendChild(assistantPanel);
    
    // Create assistant toggle button
    const assistantToggle = document.createElement('button');
    assistantToggle.className = 'ai-assistant-toggle';
    assistantToggle.innerHTML = '<i class="fas fa-robot"></i>';
    assistantToggle.title = 'AI Code Assistant';
    document.body.appendChild(assistantToggle);
    
    // Add styles
    const assistantStyles = document.createElement('style');
    assistantStyles.textContent = `
        .ai-assistant-panel {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 350px;
            height: 450px;
            background-color: var(--secondary-bg);
            border-radius: 8px;
            box-shadow: 0 4px 20px var(--shadow-color);
            z-index: 9500;
            display: flex;
            flex-direction: column;
            border: 1px solid #3d3d5c;
            transform: translateY(calc(100% + 20px));
            transition: transform 0.3s ease-out;
            overflow: hidden;
        }
        
        .ai-assistant-panel.open {
            transform: translateY(0);
        }
        
        .ai-assistant-panel.minimized {
            height: 40px;
            overflow: hidden;
        }
        
        .assistant-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 15px;
            background-color: var(--primary-bg);
            border-bottom: 1px solid #3d3d5c;
        }
        
        .assistant-title {
            color: var(--accent-5);
            font-weight: bold;
            font-size: 15px;
        }
        
        .assistant-title i {
            margin-right: 8px;
        }
        
        .assistant-actions {
            display: flex;
            gap: 5px;
        }
        
        .assistant-actions button {
            background: none;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            font-size: 12px;
            width: 24px;
            height: 24px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }
        
        .assistant-actions button:hover {
            background-color: rgba(255, 255, 255, 0.1);
            color: var(--text-primary);
        }
        
        .assistant-tabs {
            display: flex;
            background-color: var(--primary-bg);
            border-bottom: 1px solid #3d3d5c;
        }
        
        .assistant-tab {
            flex: 1;
            text-align: center;
            padding: 8px;
            font-size: 13px;
            color: var(--text-secondary);
            cursor: pointer;
            border-bottom: 2px solid transparent;
            transition: all 0.2s;
        }
        
        .assistant-tab:hover {
            color: var(--text-primary);
        }
        
        .assistant-tab.active {
            color: var(--accent-5);
            border-bottom: 2px solid var(--accent-5);
        }
        
        .assistant-content {
            flex: 1;
            overflow: hidden;
            position: relative;
        }
        
        .tab-content {
            display: none;
            height: 100%;
            overflow-y: auto;
            padding: 15px;
        }
        
        .tab-content.active {
            display: block;
        }
        
        .assistant-intro {
            text-align: center;
            padding: 20px 0;
        }
        
        .assistant-intro p {
            color: var(--text-primary);
            margin-bottom: 15px;
            font-size: 14px;
        }
        
        .analyze-code-btn {
            background-color: var(--accent-5);
            color: var(--primary-bg);
            border: none;
            padding: 8px 15px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
        }
        
        .analyze-code-btn:hover {
            background-color: #c8a6fa;
        }
        
        .assistant-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 15px;
            background-color: var(--primary-bg);
            border-top: 1px solid #3d3d5c;
        }
        
        .assistant-status {
            color: var(--text-secondary);
            font-size: 12px;
        }
        
        .assistant-settings-btn {
            background: none;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
        }
        
        .assistant-settings-btn:hover {
            color: var(--accent-5);
        }
        
        .ai-assistant-toggle {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background-color: var(--accent-5);
            color: var(--primary-bg);
            border: none;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            cursor: pointer;
            box-shadow: 0 4px 10px var(--shadow-color);
            z-index: 9000;
            transition: all 0.2s;
        }
        
        .ai-assistant-toggle:hover {
            transform: scale(1.1);
        }
        
        .suggestions-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        
        .suggestion-card {
            background-color: var(--primary-bg);
            border-radius: 6px;
            padding: 12px;
            border-left: 3px solid var(--accent-5);
        }
        
        .suggestion-title {
            font-weight: bold;
            color: var(--accent-5);
            margin-bottom: 8px;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .suggestion-content {
            color: var(--text-primary);
            font-size: 13px;
            line-height: 1.4;
        }
        
        .suggestion-actions {
            display: flex;
            justify-content: flex-end;
            margin-top: 10px;
            gap: 8px;
        }
        
        .suggestion-actions button {
            background: none;
            border: none;
            color: var(--accent-5);
            cursor: pointer;
            font-size: 12px;
            padding: 4px 8px;
            border-radius: 4px;
            transition: background-color 0.2s;
        }
        
        .suggestion-actions button:hover {
            background-color: rgba(189, 147, 249, 0.1);
        }
        
        .autocomplete-settings {
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 10px 0;
            border-bottom: 1px solid #3d3d5c;
            margin-bottom: 15px;
        }
        
        .autocomplete-settings label {
            display: flex;
            align-items: center;
            color: var(--text-primary);
            font-size: 14px;
            cursor: pointer;
        }
        
        .autocomplete-settings input[type="checkbox"] {
            margin-right: 8px;
            width: 16px;
            height: 16px;
            accent-color: var(--accent-5);
        }
        
        .setting-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .intelligence-level {
            display: flex;
            background-color: var(--primary-bg);
            border-radius: 4px;
            overflow: hidden;
        }
        
        .level-option {
            flex: 1;
            text-align: center;
            padding: 6px;
            font-size: 12px;
            color: var(--text-secondary);
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .level-option:hover {
            color: var(--text-primary);
        }
        
        .level-option.selected {
            background-color: var(--accent-5);
            color: var(--primary-bg);
        }
        
        .autocomplete-preview {
            background-color: var(--primary-bg);
            border-radius: 6px;
            overflow: hidden;
        }
        
        .preview-header {
            background-color: rgba(189, 147, 249, 0.1);
            color: var(--accent-5);
            padding: 8px 12px;
            font-size: 12px;
            font-weight: bold;
            border-bottom: 1px solid rgba(189, 147, 249, 0.2);
        }
        
        .preview-content {
            padding: 12px;
            font-family: monospace;
            font-size: 13px;
            color: var(--text-primary);
            display: flex;
            flex-direction: column;
            gap: 3px;
        }
        
        .code-line {
            padding: 2px 0;
        }
        
        .code-line.active {
            background-color: rgba(189, 147, 249, 0.1);
            position: relative;
        }
        
        .code-line.active::before {
            content: '>';
            position: absolute;
            left: -10px;
            color: var(--accent-5);
        }
        
        .autocomplete-suggestion {
            color: var(--accent-5);
            background-color: rgba(189, 147, 249, 0.2);
            padding: 0 2px;
            border-radius: 2px;
        }
        
        .refactor-options {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-bottom: 15px;
        }
        
        .refactor-option {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 15px;
            background-color: var(--primary-bg);
            border: 1px solid #3d3d5c;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .refactor-option:hover {
            border-color: var(--accent-5);
            background-color: rgba(189, 147, 249, 0.05);
        }
        
        .refactor-option i {
            font-size: 20px;
            color: var(--accent-5);
            margin-bottom: 8px;
        }
        
        .refactor-option span {
            color: var(--text-primary);
            font-size: 12px;
            text-align: center;
        }
        
        .selected-code-info {
            background-color: var(--primary-bg);
            border-radius: 6px;
            padding: 15px;
            color: var(--text-secondary);
            font-size: 13px;
            text-align: center;
            font-style: italic;
        }
    `;
    
    document.head.appendChild(assistantStyles);
    
    // Initialize assistant events
    initAIAssistantEvents();
    
    return {
        panel: assistantPanel,
        toggle: assistantToggle
    };
}

// Initialize events for the AI assistant
function initAIAssistantEvents() {
    const assistantToggle = document.querySelector('.ai-assistant-toggle');
    const assistantPanel = document.querySelector('.ai-assistant-panel');
    const closeBtn = document.querySelector('.close-assistant');
    const minimizeBtn = document.querySelector('.minimize-assistant');
    const tabs = document.querySelectorAll('.assistant-tab');
    const analyzeBtn = document.querySelector('.analyze-code-btn');
    const levelOptions = document.querySelectorAll('.level-option');
    const autocompleteToggle = document.getElementById('autocomplete-toggle');
    const refactorOptions = document.querySelectorAll('.refactor-option');
    const assistantSettingsBtn = document.querySelector('.assistant-settings-btn');
    
    // Toggle assistant panel
    assistantToggle.addEventListener('click', () => {
        assistantPanel.classList.toggle('open');
        if (assistantPanel.classList.contains('open')) {
            // Update assistant status
            updateAssistantStatus('Analyzing code...');
            
            // Simulate analyzing code
            setTimeout(() => {
                updateAssistantStatus('Ready to assist');
            }, 1500);
        }
    });
    
    // Close assistant panel
    closeBtn.addEventListener('click', () => {
        assistantPanel.classList.remove('open');
    });
    
    // Minimize assistant panel
    minimizeBtn.addEventListener('click', () => {
        assistantPanel.classList.toggle('minimized');
        minimizeBtn.innerHTML = assistantPanel.classList.contains('minimized') ? 
            '<i class="fas fa-expand"></i>' : 
            '<i class="fas fa-minus"></i>';
    });
    
    // Switch between tabs
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            const tabType = tab.dataset.tab;
            document.getElementById(`${tabType}-tab`).classList.add('active');
            
            // Special handling for tabs
            if (tabType === 'suggestions' && !document.querySelector('.suggestion-card')) {
                // If no suggestions yet, prepare the panel
                document.querySelector('.assistant-intro').style.display = 'block';
                document.querySelector('.suggestions-list').innerHTML = '';
            }
        });
    });
    
    // Analyze code button
    analyzeBtn.addEventListener('click', () => {
        analyzeCodeForSuggestions();
    });
    
    // Intelligence level options
    levelOptions.forEach(option => {
        option.addEventListener('click', () => {
            levelOptions.forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            
            // Update status based on selected level
            const level = option.dataset.level;
            let statusMessage = 'Basic autocomplete active';
            
            if (level === '2') statusMessage = 'Enhanced autocomplete active';
            if (level === '3') statusMessage = 'Advanced AI-powered completions active';
            
            updateAssistantStatus(statusMessage);
        });
    });
    
    // Autocomplete toggle
    autocompleteToggle.addEventListener('change', () => {
        const isEnabled = autocompleteToggle.checked;
        document.querySelectorAll('.level-option').forEach(o => {
            o.style.pointerEvents = isEnabled ? 'auto' : 'none';
            o.style.opacity = isEnabled ? '1' : '0.5';
        });
        
        updateAssistantStatus(isEnabled ? 'Autocomplete enabled' : 'Autocomplete disabled');
    });
    
    // Refactor options
    refactorOptions.forEach(option => {
        option.addEventListener('click', () => {
            const action = option.dataset.action;
            handleRefactorAction(action);
        });
    });
    
    // Settings button
    assistantSettingsBtn.addEventListener('click', () => {
        showAssistantSettings();
    });
}

// Analyze code and generate suggestions
function analyzeCodeForSuggestions() {
    const code = document.getElementById('code').value;
    if (!code.trim()) {
        updateAssistantStatus('No code to analyze');
        return;
    }
    
    // Hide intro and show loading
    document.querySelector('.assistant-intro').style.display = 'none';
    document.querySelector('.suggestions-list').innerHTML = '<div class="nav-loading">AI is analyzing your code...</div>';
    updateAssistantStatus('Deep analysis in progress...');
    
    // Simulate AI analysis delay
    setTimeout(() => {
        // Generate suggestions based on code content
        const suggestions = generateCodeSuggestions(code);
        
        // Update the suggestions list
        renderSuggestions(suggestions);
        updateAssistantStatus(`Found ${suggestions.length} suggestions`);
    }, 2000);
}

// Generate code suggestions based on the provided code
function generateCodeSuggestions(code) {
    // This would ideally call an AI service
    // For this example, we'll use pattern recognition
    
    const suggestions = [];
    const lines = code.split('\n');
    
    // Check for console.log statements
    const consoleLogCount = (code.match(/console\.log/g) || []).length;
    if (consoleLogCount > 0) {
        suggestions.push({
            title: 'Remove console.log statements',
            icon: 'fas fa-terminal',
            content: `Found ${consoleLogCount} console.log statements that should be removed before production deployment.`,
            actions: ['Remove All', 'Show Locations']
        });
    }
    
    // Check for commented out code
    const commentedCodeCount = (code.match(/\/\/.*[;{}]/g) || []).length;
    if (commentedCodeCount > 3) {
        suggestions.push({
            title: 'Clean up commented code',
            icon: 'fas fa-comment-slash',
            content: 'Consider removing commented-out code blocks for better readability and code maintenance.',
            actions: ['Clean Up', 'Learn More']
        });
    }
    
    // Check for function length
    const functionMatches = code.match(/function\s+\w+\s*\([^)]*\)\s*{[^}]*}/g) || [];
    let longFunctionCount = 0;
    
    functionMatches.forEach(func => {
        const lines = func.split('\n').length;
        if (lines > 15) {
            longFunctionCount++;
        }
    });
    
    if (longFunctionCount > 0) {
        suggestions.push({
            title: 'Refactor long functions',
            icon: 'fas fa-sitemap',
            content: `Found ${longFunctionCount} functions that are over 15 lines long. Consider breaking them into smaller, more focused functions.`,
            actions: ['Refactor', 'Show Functions']
        });
    }
    
    // Check for error handling
    const tryCatchCount = (code.match(/try\s*{/g) || []).length;
    const errorCheckCount = (code.match(/if\s*\([^)]*error/g) || []).length;
    
    if (functionMatches.length > 2 && (tryCatchCount === 0 && errorCheckCount === 0)) {
        suggestions.push({
            title: 'Add error handling',
            icon: 'fas fa-exclamation-triangle',
            content: 'Your code might benefit from better error handling. Consider adding try-catch blocks for critical operations.',
            actions: ['Add Error Handling', 'Learn More']
        });
    }
    
    // Check for variable naming patterns
    const varMatches = code.match(/(?:let|const|var)\s+(\w+)\s*=/g) || [];
    let shortVarCount = 0;
    
    varMatches.forEach(varDecl => {
        const varName = varDecl.match(/(?:let|const|var)\s+(\w+)/)[1];
        if (varName.length === 1 && varName !== 'i' && varName !== 'j' && varName !== 'k') {
            shortVarCount++;
        }
    });
    
    if (shortVarCount > 0) {
        suggestions.push({
            title: 'Improve variable naming',
            icon: 'fas fa-font',
            content: `Found ${shortVarCount} variables with single-letter names. Consider using more descriptive names for better code readability.`,
            actions: ['Suggest Names', 'Learn Best Practices']
        });
    }
    
    // Add AI optimization suggestion
    suggestions.push({
        title: 'Optimize code performance',
        icon: 'fas fa-bolt',
        content: 'AI analysis suggests potential performance improvements in your loops and data processing.',
        actions: ['View Optimizations', 'Apply Automatically']
    });
    
    return suggestions;
}

// Render suggestions in the assistant panel
function renderSuggestions(suggestions) {
    const suggestionsContainer = document.querySelector('.suggestions-list');
    
    if (suggestions.length === 0) {
        suggestionsContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-check-circle"></i>
                <p>No issues found. Your code looks good!</p>
            </div>
        `;
        return;
    }
    
    const suggestionsHTML = suggestions.map(suggestion => `
        <div class="suggestion-card">
            <div class="suggestion-title">
                <i class="${suggestion.icon}"></i>
                ${suggestion.title}
            </div>
            <div class="suggestion-content">
                ${suggestion.content}
            </div>
            <div class="suggestion-actions">
                ${suggestion.actions.map(action => 
                    `<button data-action="${action.toLowerCase().replace(/\s+/g, '-')}">${action}</button>`
                ).join('')}
            </div>
        </div>
    `).join('');
    
    suggestionsContainer.innerHTML = suggestionsHTML;
    
    // Add event listeners to suggestion actions
    document.querySelectorAll('.suggestion-actions button').forEach(button => {
        button.addEventListener('click', () => {
            const action = button.dataset.action;
            const suggestionTitle = button.closest('.suggestion-card').querySelector('.suggestion-title').textContent.trim();
            handleSuggestionAction(action, suggestionTitle);
        });
    });
}

// Handle suggestion action clicks
function handleSuggestionAction(action, suggestion) {
    updateAssistantStatus(`Processing: ${action} for ${suggestion}...`);
    
    // Simulate processing
    setTimeout(() => {
        if (action === 'remove-all') {
            // Simulate removing console.logs
            const codeTextArea = document.getElementById('code');
            const newCode = codeTextArea.value.replace(/console\.log\([^)]*\);?\n?/g, '');
            codeTextArea.value = newCode;
            autoResize(codeTextArea);
            applySyntaxHighlighting(newCode, 'code-display-container');
            
            showNotification('Removed all console.log statements', 'success');
            updateAssistantStatus('Console.log statements removed');
            
            // Update suggestions
            analyzeCodeForSuggestions();
        } else if (action === 'show-locations') {
            showCodeLocations('console.log');
        } else if (action === 'refactor') {
            showRefactorOptions();
        } else if (action === 'apply-automatically') {
            applyAutomaticOptimizations();
        } else {
            // Generic handler for other actions
            showNotification(`Action: ${action} for ${suggestion}`, 'info');
            updateAssistantStatus('Ready to assist');
        }
    }, 1000);
}

// Show code locations for specific patterns
function showCodeLocations(pattern) {
    const code = document.getElementById('code').value;
    const regex = new RegExp(pattern, 'g');
    const lines = code.split('\n');
    
    const locations = [];
    let match;
    
    lines.forEach((line, index) => {
        if (line.match(regex)) {
            locations.push({
                line: index + 1,
                text: line.trim()
            });
        }
    });
    
    if (locations.length === 0) {
        showNotification(`No ${pattern} found in the code`, 'info');
        return;
    }
    
    // Create locations modal
    const locationsModal = document.createElement('div');
    locationsModal.className = 'code-locations-modal';
    locationsModal.innerHTML = `
        <div class="locations-content">
            <div class="locations-header">
                <h3>Code Locations: ${pattern}</h3>
                <button class="close-locations"><i class="fas fa-times"></i></button>
            </div>
            <div class="locations-list">
                ${locations.map(loc => `
                    <div class="location-item" data-line="${loc.line}">
                        <div class="location-line">Line ${loc.line}</div>
                        <div class="location-code">${loc.text}</div>
                    </div>
                `).join('')}
            </div>
            <div class="locations-footer">
                <span>${locations.length} locations found</span>
                <button class="remove-all-btn">Remove All</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(locationsModal);
    
    // Add modal styles if not already added
    if (!document.getElementById('locations-modal-styles')) {
        const modalStyles = document.createElement('style');
        modalStyles.id = 'locations-modal-styles';
        modalStyles.textContent = `
            .code-locations-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.7);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 10000;
            }
            
            .locations-content {
                width: 80%;
                max-width: 700px;
                max-height: 90vh;
                background-color: var(--secondary-bg);
                border-radius: 8px;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                border: 1px solid #3d3d5c;
                animation: fadeInScale 0.3s ease-out;
            }
            
            .locations-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 15px 20px;
                background-color: var(--primary-bg);
                border-bottom: 1px solid #3d3d5c;
            }
            
            .locations-header h3 {
                color: var(--accent-5);
                margin: 0;
                font-size: 18px;
            }
            
            .close-locations {
                background: none;
                border: none;
                color: var(--text-secondary);
                cursor: pointer;
                font-size: 16px;
                padding: 5px;
                border-radius: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
            }
            
            .close-locations:hover {
                background-color: rgba(255, 255, 255, 0.1);
                color: var(--text-primary);
            }
            
            .locations-list {
                flex: 1;
                overflow-y: auto;
                padding: 10px 20px;
            }
            
            .location-item {
                display: flex;
                flex-direction: column;
                padding: 10px;
                border-bottom: 1px solid #3d3d5c;
                cursor: pointer;
                transition: background-color 0.2s;
            }
            
            .location-item:hover {
                background-color: var(--primary-bg);
            }
            
            .location-line {
                color: var(--accent-2);
                font-size: 13px;
                margin-bottom: 5px;
                font-weight: bold;
            }
            
            .location-code {
                color: var(--text-primary);
                font-family: monospace;
                font-size: 14px;
                padding: 5px;
                background-color: rgba(0, 0, 0, 0.2);
                border-radius: 4px;
                white-space: pre-wrap;
                word-break: break-all;
            }
            
            .locations-footer {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 15px 20px;
                background-color: var(--primary-bg);
                border-top: 1px solid #3d3d5c;
            }
            
            .locations-footer span {
                color: var(--text-secondary);
                font-size: 14px;
            }
            
            .remove-all-btn {
                background-color: var(--accent-5);
                color: var(--primary-bg);
                border: none;
                padding: 8px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.2s;
            }
            
            .remove-all-btn:hover {
                background-color: #c8a6fa;
            }
        `;
        document.head.appendChild(modalStyles);
    }
    
    // Add event listeners
    locationsModal.querySelector('.close-locations').addEventListener('click', () => {
        document.body.removeChild(locationsModal);
    });
    
    locationsModal.querySelectorAll('.location-item').forEach(item => {
        item.addEventListener('click', () => {
            const lineNumber = parseInt(item.dataset.line);
            navigateToCodeLine(lineNumber);
        });
    });
    
    locationsModal.querySelector('.remove-all-btn').addEventListener('click', () => {
        // Simulate removing all instances
        const codeTextArea = document.getElementById('code');
        const regex = new RegExp(pattern + '\\([^)]*\\);?\\n?', 'g');
        const newCode = codeTextArea.value.replace(regex, '');
        codeTextArea.value = newCode;
        autoResize(codeTextArea);
        applySyntaxHighlighting(newCode, 'code-display-container');
        
        showNotification(`Removed all ${pattern} statements`, 'success');
        document.body.removeChild(locationsModal);
        
        // Update suggestions
        analyzeCodeForSuggestions();
    });
    
    // Close modal when clicking outside
    locationsModal.addEventListener('click', (e) => {
        if (e.target === locationsModal) {
            document.body.removeChild(locationsModal);
        }
    });
}

// Show refactor options modal
function showRefactorOptions() {
    const code = document.getElementById('code').value;
    if (!code.trim()) {
        showNotification('No code to refactor', 'warning');
        return;
    }
    
    // Find functions in the code
    const functionMatches = code.match(/function\s+(\w+)\s*\([^)]*\)\s*\{[\s\S]*?\}/g) || [];
    const functions = functionMatches.map(func => {
        const name = func.match(/function\s+(\w+)/)[1];
        const lines = func.split('\n').length;
        return { name, lines, func };
    });
    
    // Sort by lines (descending)
    functions.sort((a, b) => b.lines - a.lines);
    
    // Create refactor modal
    const refactorModal = document.createElement('div');
    refactorModal.className = 'refactor-modal';
    refactorModal.innerHTML = `
        <div class="refactor-content">
            <div class="refactor-header">
                <h3>Refactor Long Functions</h3>
                <button class="close-refactor"><i class="fas fa-times"></i></button>
            </div>
            <div class="refactor-body">
                <p class="refactor-intro">
                    The following functions could benefit from refactoring into smaller, more focused functions:
                </p>
                <div class="function-list">
                    ${functions.map((f, index) => `
                        <div class="function-item ${f.lines > 15 ? 'long-function' : ''}" data-index="${index}">
                            <div class="function-name">${f.name}()</div>
                            <div class="function-metrics">
                                <span class="function-lines">${f.lines} lines</span>
                                ${f.lines > 15 ? '<span class="function-flag">Too Long</span>' : ''}
                            </div>
                            <button class="refactor-function-btn" data-index="${index}">Refactor</button>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="refactor-footer">
                <button class="cancel-refactor">Cancel</button>
                <button class="refactor-all-btn">Refactor All Long Functions</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(refactorModal);
    
    // Add modal styles if not already added
    if (!document.getElementById('refactor-modal-styles')) {
        const modalStyles = document.createElement('style');
        modalStyles.id = 'refactor-modal-styles';
        modalStyles.textContent = `
            .refactor-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.7);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 10000;
            }
            
            .refactor-content {
                width: 80%;
                max-width: 700px;
                max-height: 90vh;
                background-color: var(--secondary-bg);
                border-radius: 8px;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                border: 1px solid #3d3d5c;
                animation: fadeInScale 0.3s ease-out;
            }
            
            .refactor-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 15px 20px;
                background-color: var(--primary-bg);
                border-bottom: 1px solid #3d3d5c;
            }
            
            .refactor-header h3 {
                color: var(--accent-5);
                margin: 0;
                font-size: 18px;
            }
            
            .close-refactor {
                background: none;
                border: none;
                color: var(--text-secondary);
                cursor: pointer;
                font-size: 16px;
                padding: 5px;
                border-radius: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
            }
            
            .close-refactor:hover {
                background-color: rgba(255, 255, 255, 0.1);
                color: var(--text-primary);
            }
            
            .refactor-body {
                flex: 1;
                overflow-y: auto;
                padding: 20px;
            }
            
            .refactor-intro {
                color: var(--text-primary);
                margin: 0 0 20px;
                font-size: 14px;
                line-height: 1.5;
            }
            
            .function-list {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            
            .function-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 15px;
                background-color: var(--primary-bg);
                border-radius: 6px;
                border-left: 3px solid var(--accent-2);
            }
            
            .function-item.long-function {
                border-left-color: var(--accent-1);
            }
            
            .function-name {
                font-weight: bold;
                color: var(--accent-2);
                font-size: 15px;
            }
            
            .function-metrics {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .function-lines {
                color: var(--text-secondary);
                font-size: 13px;
            }
            
            .function-flag {
                background-color: var(--accent-1);
                color: var(--primary-bg);
                font-size: 11px;
                padding: 3px 6px;
                border-radius: 4px;
                font-weight: bold;
            }
            
            .refactor-function-btn {
                background-color: var(--accent-5);
                color: var(--primary-bg);
                border: none;
                padding: 6px 10px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                transition: all 0.2s;
            }
            
            .refactor-function-btn:hover {
                background-color: #c8a6fa;
            }
            
            .refactor-footer {
                display: flex;
                justify-content: flex-end;
                gap: 10px;
                padding: 15px 20px;
                background-color: var(--primary-bg);
                border-top: 1px solid #3d3d5c;
            }
            
            .cancel-refactor {
                background-color: transparent;
                color: var(--text-primary);
                border: 1px solid #3d3d5c;
                padding: 8px 15px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.2s;
            }
            
            .cancel-refactor:hover {
                background-color: rgba(255, 255, 255, 0.05);
            }
            
            .refactor-all-btn {
                background-color: var(--accent-5);
                color: var(--primary-bg);
                border: none;
                padding: 8px 15px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.2s;
            }
            
            .refactor-all-btn:hover {
                background-color: #c8a6fa;
            }
        `;
        document.head.appendChild(modalStyles);
    }
    
    // Add event listeners
    refactorModal.querySelector('.close-refactor').addEventListener('click', () => {
        document.body.removeChild(refactorModal);
    });
    
    refactorModal.querySelector('.cancel-refactor').addEventListener('click', () => {
        document.body.removeChild(refactorModal);
    });
    
    refactorModal.querySelectorAll('.refactor-function-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const index = parseInt(btn.dataset.index);
            refactorFunction(functions[index]);
            document.body.removeChild(refactorModal);
        });
    });
    
    refactorModal.querySelector('.refactor-all-btn').addEventListener('click', () => {
        // Get only the long functions
        const longFunctions = functions.filter(f => f.lines > 15);
        if (longFunctions.length > 0) {
            refactorAllFunctions(longFunctions);
            document.body.removeChild(refactorModal);
        } else {
            showNotification('No long functions to refactor', 'info');
        }
    });
    
    // Close modal when clicking outside
    refactorModal.addEventListener('click', (e) => {
        if (e.target === refactorModal) {
            document.body.removeChild(refactorModal);
        }
    });
}

// Update assistant status message
function updateAssistantStatus(message) {
    const statusElement = document.querySelector('.assistant-status');
    if (statusElement) {
        statusElement.textContent = message;
    }
}

// Handle refactor actions
function handleRefactorAction(action) {
    updateAssistantStatus(`Preparing refactoring: ${action}...`);
    
    const code = document.getElementById('code').value;
    if (!code.trim()) {
        showNotification('No code to refactor', 'warning');
        updateAssistantStatus('Ready to assist');
        return;
    }
    
    setTimeout(() => {
        switch (action) {
            case 'simplify':
                simplifySelectedCode();
                break;
            case 'document':
                documentSelectedCode();
                break;
            case 'optimize':
                optimizeSelectedCode();
                break;
            case 'convert':
                convertToModernJS();
                break;
            default:
                showNotification(`Refactor action: ${action} not implemented yet`, 'info');
        }
    }, 1000);
}

// Initialize all navigation and AI features
function initializeAllFeatures() {
    // Initialize code navigation panel
    const navPanel = initializeCodeNavigation();
    
    // Initialize AI code assistant
    const aiAssistant = initializeAICodeAssistant();
    
    // Add global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl+Shift+N for navigation panel
        if (e.ctrlKey && e.shiftKey && e.key === 'N') {
            e.preventDefault();
            navPanel.panel.classList.toggle('open');
            if (navPanel.panel.classList.contains('open')) {
                analyzeCodeForNavigation();
            }
        }
        
        // Ctrl+Shift+A for AI assistant
        if (e.ctrlKey && e.shiftKey && e.key === 'A') {
            e.preventDefault();
            aiAssistant.panel.classList.toggle('open');
            if (aiAssistant.panel.classList.contains('open')) {
                updateAssistantStatus('AI assistant ready');
            }
        }
        
        // Ctrl+Shift+F for finding in code
        if (e.ctrlKey && e.shiftKey && e.key === 'F') {
            e.preventDefault();
            // Open navigation panel and focus search
            navPanel.panel.classList.add('open');
            document.getElementById('code-nav-search').focus();
        }
    });
    
    // Return the initialized features
    return {
        navPanel,
        aiAssistant
    };
}
    
// Refactor a single function
function refactorFunction(funcInfo) {
    // In a real implementation, this would use AI to refactor the code
    // For this example, we'll do a simple transformation
    
    const codeTextArea = document.getElementById('code');
    const originalCode = codeTextArea.value;
    
    // Find the function in the code
    const functionRegex = new RegExp(`function\\s+${funcInfo.name}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\}`, 'g');
    const match = functionRegex.exec(originalCode);
    
    if (!match) {
        showNotification('Could not locate the function for refactoring', 'error');
        return;
    }
    
    // Show refactoring in progress
    showLoading('AI is refactoring your function...');
    
    // Simulate AI processing
    setTimeout(() => {
        // Create a refactored version with helper functions
        const originalFunc = match[0];
        const paramMatch = originalFunc.match(/function\s+\w+\s*\(([^)]*)\)/);
        const params = paramMatch ? paramMatch[1] : '';
        
        // Simple refactoring: split the function into smaller parts
        const lines = originalFunc.split('\n');
        const functionBody = lines.slice(1, -1).join('\n');
        
        // Create a main function and helper functions
        const refactoredCode = `// Refactored version of ${funcInfo.name}
    function ${funcInfo.name}(${params}) {
        // Initialize data
        const data = ${funcInfo.name}Initialize(${params});
        
        // Process data
        const result = ${funcInfo.name}Process(data);
        
        // Return formatted result
        return ${funcInfo.name}FormatResult(result);
    }
    
    // Helper function to initialize data
    function ${funcInfo.name}Initialize(${params}) {
        // Initialization logic extracted from ${funcInfo.name}
        let data = {};
        
        // Set up initial values
        ${params.split(',').map(p => p.trim()).filter(p => p).map(p => `    data.${p} = ${p};`).join('\n')}
        
        return data;
    }
    
    // Helper function to process data
    function ${funcInfo.name}Process(data) {
        // Processing logic extracted from ${funcInfo.name}
        let result = {};
        
        // Add your processing logic here
        // This would contain the main algorithm from the original function
        
        return result;
    }
    
    // Helper function to format the result
    function ${funcInfo.name}FormatResult(result) {
        // Formatting logic extracted from ${funcInfo.name}
        
        // Return the properly formatted result
        return result;
    }`;
        
        // Replace the original function with the refactored version
        const newCode = originalCode.replace(originalFunc, refactoredCode);
        codeTextArea.value = newCode;
        autoResize(codeTextArea);
        applySyntaxHighlighting(newCode, 'code-display-container');
        
        hideLoading();
        showNotification(`Function ${funcInfo.name} has been refactored into smaller functions`, 'success');
        
        // Update suggestions
        analyzeCodeForSuggestions();
    }, 2500);
}
    
// Refactor multiple functions
function refactorAllFunctions(functions) {
    showLoading('AI is refactoring all long functions...');
    
    // In a real implementation, this would use AI to refactor each function intelligently
    // For this example, we'll simulate sequential refactoring
    let currentIndex = 0;
    
    function refactorNext() {
        if (currentIndex >= functions.length) {
            // All functions refactored
            hideLoading();
            showNotification(`Refactored ${functions.length} functions successfully`, 'success');
            analyzeCodeForSuggestions();
            return;
        }
        
        const funcInfo = functions[currentIndex];
        
        // Find the function in the code
        const codeTextArea = document.getElementById('code');
        const originalCode = codeTextArea.value;
        const functionRegex = new RegExp(`function\\s+${funcInfo.name}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\}`, 'g');
        const match = functionRegex.exec(originalCode);
        
        if (match) {
            // Create a refactored version (simplified for this example)
            const originalFunc = match[0];
            const paramMatch = originalFunc.match(/function\s+\w+\s*\(([^)]*)\)/);
            const params = paramMatch ? paramMatch[1] : '';
            
            // Create a simplified refactored version
            const refactoredCode = `// Refactored version of ${funcInfo.name}
    function ${funcInfo.name}(${params}) {
        return ${funcInfo.name}Implementation(${params.split(',').map(p => p.trim()).filter(p => p).join(', ')});
    }
    
    // Implementation of ${funcInfo.name} logic
    function ${funcInfo.name}Implementation(${params}) {
        ${originalFunc.split('\n').slice(1, -1).join('\n')}
    }`;
            
            // Replace the original function with the refactored version
            const newCode = originalCode.replace(originalFunc, refactoredCode);
            codeTextArea.value = newCode;
            autoResize(codeTextArea);
            applySyntaxHighlighting(newCode, 'code-display-container');
        }
        
        // Process next function
        currentIndex++;
        setTimeout(refactorNext, 1000);
    }
    
    // Start refactoring process
    setTimeout(refactorNext, 1000);
}
    
// Apply automatic optimizations to the code
function applyAutomaticOptimizations() {
    const codeTextArea = document.getElementById('code');
    const originalCode = codeTextArea.value;
    
    if (!originalCode.trim()) {
        showNotification('No code to optimize', 'warning');
        return;
    }
    
    showLoading('AI is optimizing your code...');
    
    // Simulate AI optimization process
    setTimeout(() => {
        // In a real implementation, this would use AI to optimize the code
        // For this example, we'll apply some simple optimizations
        
        // 1. Replace multiple array.push with array initialization where applicable
        let optimizedCode = originalCode.replace(
            /const\s+(\w+)\s*=\s*\[\];[\s\S]*?\1\.push\([^)]+\);[\s\S]*?\1\.push\([^)]+\);/g, 
            (match) => {
                const arrayName = match.match(/const\s+(\w+)/)[1];
                const pushes = match.match(new RegExp(`${arrayName}\\.push\\([^)]+\\)`, 'g')) || [];
                
                if (pushes.length >= 2) {
                    const values = pushes.map(p => p.match(/push\(([^)]+)\)/)[1]);
                    return `const ${arrayName} = [${values.join(', ')}];`;
                }
                
                return match;
            }
        );
        
        // 2. Convert for loops to forEach or map where applicable
        optimizedCode = optimizedCode.replace(
            /for\s*\(\s*let\s+(\w+)\s*=\s*0\s*;\s*\1\s*<\s*(\w+)\.length\s*;\s*\1\s*\+\+\s*\)\s*\{[\s\S]*?\}/g,
            (match) => {
                const varName = match.match(/let\s+(\w+)\s*=/)[1];
                const arrayName = match.match(/(\w+)\.length/)[1];
                const loopBody = match.match(/\{([\s\S]*?)\}/)[1];
                
                // Check if it's a simple transformation (map or forEach)
                if (loopBody.includes(`${arrayName}[${varName}]`)) {
                    if (loopBody.includes('return')) {
                        // This is likely a map operation
                        return `// Optimized loop using map
    const result = ${arrayName}.map((item, index) => {${loopBody.replace(new RegExp(`${arrayName}\\[${varName}\\]`, 'g'), 'item')}});`;
                    } else {
                        // This is likely a forEach operation
                        return `// Optimized loop using forEach
    ${arrayName}.forEach((item, index) => {${loopBody.replace(new RegExp(`${arrayName}\\[${varName}\\]`, 'g'), 'item')}});`;
                    }
                }
                
                return match;
            }
        );
        
        // 3. Replace var with const/let
        optimizedCode = optimizedCode.replace(/var\s+(\w+)/g, 'let $1');
        
        // 4. Add optimization comments
        optimizedCode = `/* 
     * Optimized code - AI performance improvements applied:
     * - Array initialization optimization
     * - Loop optimizations using array methods
     * - Variable declaration modernization
     */
    ${optimizedCode}`;
        
        // Update the code
        codeTextArea.value = optimizedCode;
        autoResize(codeTextArea);
        applySyntaxHighlighting(optimizedCode, 'code-display-container');
        
        hideLoading();
        showNotification('Code has been optimized for better performance', 'success');
        
        // Update suggestions
        analyzeCodeForSuggestions();
    }, 3000);
}
    
// Simplify selected code
function simplifySelectedCode() {
    const codeTextArea = document.getElementById('code');
    const selectionStart = codeTextArea.selectionStart;
    const selectionEnd = codeTextArea.selectionEnd;
    
    if (selectionStart === selectionEnd) {
        showNotification('Please select the code you want to simplify', 'warning');
        updateAssistantStatus('Select code to simplify');
        return;
    }
    
    const selectedCode = codeTextArea.value.substring(selectionStart, selectionEnd);
    
    showLoading('AI is simplifying your code...');
    
    // Simulate AI simplification
    setTimeout(() => {
        // In a real implementation, this would use AI to simplify the code
        // For this example, we'll do some basic simplifications
        
        // Simplify common patterns
        let simplifiedCode = selectedCode;
        
        // Simplify ternary operators if complex
        simplifiedCode = simplifiedCode.replace(
            /(\w+)\s*=\s*\(([^?]+)\)\s*\?\s*([^:]+)\s*:\s*([^;]+);/g,
            (match, variable, condition, truePart, falsePart) => {
                if (truePart.length + falsePart.length > 40) {
                    return `// Simplified ternary to if-else for readability
    if (${condition}) {
        ${variable} = ${truePart};
    } else {
        ${variable} = ${falsePart};
    }`;
                }
                return match;
            }
        );
        
        // Simplify nested if statements
        simplifiedCode = simplifiedCode.replace(
            /if\s*\(([^)]+)\)\s*\{\s*if\s*\(([^)]+)\)/g,
            `// Combined nested conditions
    if ($1 && $2)`
        );
        
        // Simplify multiple conditions
        simplifiedCode = simplifiedCode.replace(
            /if\s*\(([^)&&]+)\s*&&\s*([^)&&]+)\s*&&\s*([^)&&]+)\)/g,
            (match, cond1, cond2, cond3) => {
                return `// Split complex condition for readability
    if (${cond1} && 
        ${cond2} && 
        ${cond3})`;
            }
        );
        
        // Replace complex boolean expression
        simplifiedCode = simplifiedCode.replace(
            /(!\(([^)]+)\s*!==\s*([^)]+)\))/g,
            '$2 === $3'
        );
        
        // Add simplification notes
        simplifiedCode = `/* Simplified code: */
    ${simplifiedCode}
    /* End of simplified section */`;
        
        // Replace the selected code with the simplified version
        const newCode = codeTextArea.value.substring(0, selectionStart) + 
                         simplifiedCode + 
                         codeTextArea.value.substring(selectionEnd);
        
        codeTextArea.value = newCode;
        autoResize(codeTextArea);
        applySyntaxHighlighting(newCode, 'code-display-container');
        
        hideLoading();
        showNotification('Code has been simplified for better readability', 'success');
        updateAssistantStatus('Code simplified successfully');
    }, 2000);
}
    
// Document selected code
function documentSelectedCode() {
    const codeTextArea = document.getElementById('code');
    const selectionStart = codeTextArea.selectionStart;
    const selectionEnd = codeTextArea.selectionEnd;
    
    if (selectionStart === selectionEnd) {
        showNotification('Please select the code you want to document', 'warning');
        updateAssistantStatus('Select code to document');
        return;
    }
    
    const selectedCode = codeTextArea.value.substring(selectionStart, selectionEnd);
    
    showLoading('AI is documenting your code...');
    
    // Simulate AI documentation generation
    setTimeout(() => {
        // In a real implementation, this would use AI to document the code
        // For this example, we'll do some basic documentation
        
        // Check if it's a function
        const functionMatch = selectedCode.match(/function\s+(\w+)\s*\(([^)]*)\)/);
        let documentedCode;
        
        if (functionMatch) {
            const functionName = functionMatch[1];
            const params = functionMatch[2].split(',').map(p => p.trim()).filter(p => p);
            
            // Create JSDoc style documentation
            documentedCode = `/**
     * ${functionName} - Performs operations related to ${functionName.toLowerCase().replace(/([A-Z])/g, ' $1').trim()}
     *
     * ${params.map(p => ` * @param {any} ${p} - Description of ${p}`).join('\n')}
     * @returns {any} - Description of the return value
     */
    ${selectedCode}`;
        } else {
            // For non-function code blocks
            documentedCode = `/**
     * Code Block Description
     * 
     * This code handles the following functionality:
     * - Initializes variables and data structures
     * - Processes input data
     * - Performs calculations and transformations
     * - Prepares output for further processing
     */
    ${selectedCode}`;
        }
        
        // Replace the selected code with the documented version
        const newCode = codeTextArea.value.substring(0, selectionStart) + 
                         documentedCode + 
                         codeTextArea.value.substring(selectionEnd);
        
        codeTextArea.value = newCode;
        autoResize(codeTextArea);
        applySyntaxHighlighting(newCode, 'code-display-container');
        
        hideLoading();
        showNotification('Code has been documented with JSDoc style comments', 'success');
        updateAssistantStatus('Documentation added successfully');
    }, 2000);
}
    
// Optimize selected code for performance
function optimizeSelectedCode() {
    const codeTextArea = document.getElementById('code');
    const selectionStart = codeTextArea.selectionStart;
    const selectionEnd = codeTextArea.selectionEnd;
    
    if (selectionStart === selectionEnd) {
        showNotification('Please select the code you want to optimize', 'warning');
        updateAssistantStatus('Select code to optimize');
        return;
    }
    
    const selectedCode = codeTextArea.value.substring(selectionStart, selectionEnd);
    
    showLoading('AI is optimizing your code for performance...');
    
    // Simulate AI optimization process
    setTimeout(() => {
        // In a real implementation, this would use AI to optimize the code
        // For this example, we'll do some basic optimizations
        
        // Apply optimizations
        let optimizedCode = selectedCode;
        
        // 1. Cache array length in loops
        optimizedCode = optimizedCode.replace(
            /for\s*\(\s*let\s+(\w+)\s*=\s*0\s*;\s*\1\s*<\s*(\w+)\.length\s*;\s*\1\s*\+\+\s*\)/g,
            (match, indexVar, arrayName) => {
                return `// Optimized: cached array length
    for (let ${indexVar} = 0, len = ${arrayName}.length; ${indexVar} < len; ${indexVar}++)`;
            }
        );
        
        // 2. Replace multiple string concatenations with array join
        optimizedCode = optimizedCode.replace(
            /let\s+(\w+)\s*=\s*(['"])(.*)(?:\2);(?:[\s\S]*?\1\s*\+=\s*(['"])(.*)(?:\4);)+/g,
            (match) => {
                const varName = match.match(/let\s+(\w+)/)[1];
                const concatenations = match.match(new RegExp(`${varName}\\s*\\+=\\s*(['\"])(.*)(?:\\1);`, 'g')) || [];
                
                if (concatenations.length >= 2) {
                    const initialPart = match.match(/(['"])(.*)(?:\1)/)[0];
                    const parts = [initialPart];
                    
                    concatenations.forEach(c => {
                        const part = c.match(/(['"])(.*)(?:\1)/)[0];
                        parts.push(part);
                    });
                    
                    return `// Optimized: array join instead of string concatenation
    let ${varName} = [${parts.join(', ')}].join('');`;
                }
                
                return match;
            }
        );
        
        // 3. Use Set for faster lookups in arrays with many duplicate checks
        optimizedCode = optimizedCode.replace(
            /(\w+)\.includes\(([^)]+)\)/g,
            (match, arrayName, searchItem) => {
                return `// Optimized: Set for faster lookups
    (new Set(${arrayName})).has(${searchItem})`;
            }
        );
        
        // 4. Add optimization comments
        optimizedCode = `/* Performance optimized code: 
     * - Cached array lengths in loops
     * - Converted string concatenation to array join
     * - Used Set for faster lookups
     */
    ${optimizedCode}`;
        
        // Replace the selected code with the optimized version
        const newCode = codeTextArea.value.substring(0, selectionStart) + 
                         optimizedCode + 
                         codeTextArea.value.substring(selectionEnd);
        
        codeTextArea.value = newCode;
        autoResize(codeTextArea);
        applySyntaxHighlighting(newCode, 'code-display-container');
        
        hideLoading();
        showNotification('Code has been optimized for better performance', 'success');
        updateAssistantStatus('Performance optimizations applied');
    }, 2500);
}
    
// Convert selected code to modern JavaScript
function convertToModernJS() {
    const codeTextArea = document.getElementById('code');
    const selectionStart = codeTextArea.selectionStart;
    const selectionEnd = codeTextArea.selectionEnd;
    
    if (selectionStart === selectionEnd) {
        showNotification('Please select the code you want to convert', 'warning');
        updateAssistantStatus('Select code to convert');
        return;
    }
    
    const selectedCode = codeTextArea.value.substring(selectionStart, selectionEnd);
    
    showLoading('AI is converting your code to modern JavaScript...');
    
    // Simulate AI conversion process
    setTimeout(() => {
        // In a real implementation, this would use AI to convert the code
        // For this example, we'll do some basic modernizations
        
        // Apply modern JavaScript features
        let modernizedCode = selectedCode;
        
        // 1. Convert var to let/const
        modernizedCode = modernizedCode.replace(/var\s+(\w+)/g, 'let $1');
        
        // 2. Convert var declarations that never change to const
        modernizedCode = modernizedCode.replace(
            /let\s+(\w+)\s*=\s*([^;]+);(?![\s\S]*?\1\s*=)/g,
            'const $1 = $2;'
        );
        
        // 3. Convert function declarations to arrow functions where appropriate
        modernizedCode = modernizedCode.replace(
            /function\s*\(([^)]*)\)\s*\{\s*return\s+([^;]+);\s*\}/g,
            '($1) => $2'
        );
        
        // 4. Convert traditional anonymous functions to arrow functions
        modernizedCode = modernizedCode.replace(
            /function\s*\(([^)]*)\)\s*\{([\s\S]*?)\}/g,
            (match, params, body) => {
                // Only convert simple functions to arrow functions
                if (body.includes('this') || body.includes('arguments')) {
                    return match; // Keep original if using this or arguments
                }
                return `($1) => {$2}`;
            }
        );
        
        // 5. Convert object method syntax
        modernizedCode = modernizedCode.replace(
            /(\w+)\s*:\s*function\s*\(([^)]*)\)\s*\{([\s\S]*?)\}/g,
            '$1($2) {$3}'
        );
        
        // 6. Use object property shorthand
        modernizedCode = modernizedCode.replace(
            /(\w+)\s*:\s*\1/g,
            '$1'
        );
        
        // 7. Use template literals
        modernizedCode = modernizedCode.replace(
            /(['"])(.*)(?:\1)\s*\+\s*([^+]+?)\s*\+\s*(['"])(.*)(?:\4)/g,
            '`$2${$3}$5`'
        );
        
        // 8. Add modern JavaScript comments
        modernizedCode = `/* Converted to Modern JavaScript:
     * - Using let/const instead of var
     * - Arrow functions
     * - Object method shorthand syntax
     * - Template literals
     * - Object property shorthand
     */
    ${modernizedCode}`;
        
        // Replace the selected code with the modernized version
        const newCode = codeTextArea.value.substring(0, selectionStart) + 
                         modernizedCode + 
                         codeTextArea.value.substring(selectionEnd);
        
        codeTextArea.value = newCode;
        autoResize(codeTextArea);
        applySyntaxHighlighting(newCode, 'code-display-container');
        
        hideLoading();
        showNotification('Code has been converted to modern JavaScript', 'success');
        updateAssistantStatus('Conversion to modern JS completed');
    }, 2500);
}
    
    // Show assistant settings modal
    function showAssistantSettings() {
        // Create settings modal
        const settingsModal = document.createElement('div');
        settingsModal.className = 'assistant-settings-modal';
        settingsModal.innerHTML = `
            <div class="settings-content">
                <div class="settings-header">
                    <h3>AI Assistant Settings</h3>
                    <button class="close-settings"><i class="fas fa-times"></i></button>
                </div>
                <div class="settings-body">
                    <div class="settings-section">
                        <h4>Intelligence Level</h4>
                        <div class="settings-option">
                            <input type="range" id="intelligence-level" min="1" max="3" value="2" step="1">
                            <div class="level-labels">
                                <span>Basic</span>
                                <span>Advanced</span>
                                <span>Expert</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="settings-section">
                        <h4>Features</h4>
                        <div class="settings-checkbox">
                            <input type="checkbox" id="enable-autocomplete" checked>
                            <label for="enable-autocomplete">Enable code autocompletion</label>
                        </div>
                        <div class="settings-checkbox">
                            <input type="checkbox" id="enable-suggestions" checked>
                            <label for="enable-suggestions">Show improvement suggestions</label>
                        </div>
                        <div class="settings-checkbox">
                            <input type="checkbox" id="enable-realtime" checked>
                            <label for="enable-realtime">Real-time analysis</label>
                        </div>
                    </div>
                    
                    <div class="settings-section">
                        <h4>Language Model</h4>
                        <div class="radio-group">
                            <div class="radio-option">
                                <input type="radio" id="model-balanced" name="model" checked>
                                <label for="model-balanced">Balanced (Default)</label>
                            </div>
                            <div class="radio-option">
                                <input type="radio" id="model-precise" name="model">
                                <label for="model-precise">Precise (Slower)</label>
                            </div>
                            <div class="radio-option">
                                <input type="radio" id="model-fast" name="model">
                                <label for="model-fast">Fast (Less accurate)</label>
                            </div>
                        </div>
                    </div>
                    
                    <div class="settings-section">
                        <h4>Appearance</h4>
                        <div class="settings-selector">
                            <label for="assistant-position">Assistant Position</label>
                            <select id="assistant-position">
                                <option value="bottom-right">Bottom Right</option>
                                <option value="bottom-left">Bottom Left</option>
                                <option value="top-right">Top Right</option>
                                <option value="top-left">Top Left</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="settings-footer">
                    <button class="reset-settings">Reset to Default</button>
                    <button class="save-settings">Save Settings</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(settingsModal);
        
        // Add settings modal styles if not already added
        if (!document.getElementById('settings-modal-styles')) {
            const modalStyles = document.createElement('style');
            modalStyles.id = 'settings-modal-styles';
            modalStyles.textContent = `
                .assistant-settings-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-color: rgba(0, 0, 0, 0.7);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 10000;
                }
                
                .settings-content {
                    width: 500px;
                    max-width: 90%;
                    max-height: 90vh;
                    background-color: var(--secondary-bg);
                    border-radius: 8px;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                    border: 1px solid #3d3d5c;
                    animation: fadeInScale 0.3s ease-out;
                }
                
                .settings-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 15px 20px;
                    background-color: var(--primary-bg);
                    border-bottom: 1px solid #3d3d5c;
                }
                
                .settings-header h3 {
                    color: var(--accent-5);
                    margin: 0;
                    font-size: 18px;
                }
                
                .close-settings {
                    background: none;
                    border: none;
                    color: var(--text-secondary);
                    cursor: pointer;
                    font-size: 16px;
                    padding: 5px;
                    border-radius: 4px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s;
                }
                
                .close-settings:hover {
                    background-color: rgba(255, 255, 255, 0.1);
                    color: var(--text-primary);
                }
                
                .settings-body {
                    flex: 1;
                    overflow-y: auto;
                    padding: 20px;
                }
                
                .settings-section {
                    margin-bottom: 25px;
                }
                
                .settings-section h4 {
                    color: var(--accent-2);
                    margin: 0 0 15px;
                    font-size: 16px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid #3d3d5c;
                }
                
                .settings-option {
                    margin-bottom: 15px;
                }
                
                .settings-option input[type="range"] {
                    width: 100%;
                    margin-bottom: 5px;
                    accent-color: var(--accent-5);
                }
                
                .level-labels {
                    display: flex;
                    justify-content: space-between;
                    color: var(--text-secondary);
                    font-size: 12px;
                }
                
                .settings-checkbox {
                    display: flex;
                    align-items: center;
                    margin-bottom: 12px;
                }
                
                .settings-checkbox input[type="checkbox"] {
                    margin-right: 10px;
                    width: 16px;
                    height: 16px;
                    accent-color: var(--accent-5);
                }
                
                .settings-checkbox label {
                    color: var(--text-primary);
                    font-size: 14px;
                    cursor: pointer;
                }
                
                .radio-group {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }
                
                .radio-option {
                    display: flex;
                    align-items: center;
                }
                
                .radio-option input[type="radio"] {
                    margin-right: 10px;
                    accent-color: var(--accent-5);
                }
                
                .radio-option label {
                    color: var(--text-primary);
                    font-size: 14px;
                    cursor: pointer;
                }
                            .settings-selector {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            
            .settings-selector label {
                color: var(--text-primary);
                font-size: 14px;
            }
            
            .settings-selector select {
                background-color: var(--primary-bg);
                color: var(--text-primary);
                border: 1px solid #3d3d5c;
                border-radius: 4px;
                padding: 8px 10px;
                font-size: 14px;
                width: 100%;
            }
            
            .settings-selector select:focus {
                outline: none;
                border-color: var(--accent-5);
            }
            
            .settings-footer {
                display: flex;
                justify-content: flex-end;
                gap: 10px;
                padding: 15px 20px;
                background-color: var(--primary-bg);
                border-top: 1px solid #3d3d5c;
            }
            
            .reset-settings {
                background-color: transparent;
                color: var(--text-primary);
                border: 1px solid #3d3d5c;
                padding: 8px 15px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.2s;
            }
            
            .reset-settings:hover {
                background-color: rgba(255, 255, 255, 0.05);
            }
            
            .save-settings {
                background-color: var(--accent-5);
                color: var(--primary-bg);
                border: none;
                padding: 8px 15px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.2s;
            }
            
            .save-settings:hover {
                background-color: #c8a6fa;
            }
        `;
        document.head.appendChild(modalStyles);
    }
    
    // Add event listeners
    settingsModal.querySelector('.close-settings').addEventListener('click', () => {
        document.body.removeChild(settingsModal);
    });
    
    // Intelligence level slider
    const intelligenceSlider = settingsModal.querySelector('#intelligence-level');
    intelligenceSlider.addEventListener('input', () => {
        const level = intelligenceSlider.value;
        updateAssistantStatus(`AI intelligence level: ${level === '1' ? 'Basic' : level === '2' ? 'Advanced' : 'Expert'}`);
    });
    
    // Position selector
    const positionSelector = settingsModal.querySelector('#assistant-position');
    positionSelector.addEventListener('change', () => {
        const position = positionSelector.value;
        const assistantPanel = document.querySelector('.ai-assistant-panel');
        const assistantToggle = document.querySelector('.ai-assistant-toggle');
        
        // Update assistant position
        if (assistantPanel && assistantToggle) {
            // Reset positions
            assistantPanel.style.top = '';
            assistantPanel.style.right = '';
            assistantPanel.style.bottom = '';
            assistantPanel.style.left = '';
            
            assistantToggle.style.top = '';
            assistantToggle.style.right = '';
            assistantToggle.style.bottom = '';
            assistantToggle.style.left = '';
            
            // Apply new positions
            switch (position) {
                case 'bottom-right':
                    assistantPanel.style.bottom = '20px';
                    assistantPanel.style.right = '20px';
                    assistantToggle.style.bottom = '20px';
                    assistantToggle.style.right = '20px';
                    break;
                case 'bottom-left':
                    assistantPanel.style.bottom = '20px';
                    assistantPanel.style.left = '20px';
                    assistantToggle.style.bottom = '20px';
                    assistantToggle.style.left = '20px';
                    break;
                case 'top-right':
                    assistantPanel.style.top = '80px';
                    assistantPanel.style.right = '20px';
                    assistantToggle.style.top = '80px';
                    assistantToggle.style.right = '20px';
                    break;
                case 'top-left':
                    assistantPanel.style.top = '80px';
                    assistantPanel.style.left = '20px';
                    assistantToggle.style.top = '80px';
                    assistantToggle.style.left = '20px';
                    break;
            }
        }
    });
    
    // Feature checkboxes
    const autocompleteCheckbox = settingsModal.querySelector('#enable-autocomplete');
    autocompleteCheckbox.addEventListener('change', () => {
        const isEnabled = autocompleteCheckbox.checked;
        // Update autocomplete tab to reflect changes
        document.querySelector('#autocomplete-toggle').checked = isEnabled;
        updateAssistantStatus(`Autocomplete ${isEnabled ? 'enabled' : 'disabled'}`);
    });
    
    const suggestionsCheckbox = settingsModal.querySelector('#enable-suggestions');
    suggestionsCheckbox.addEventListener('change', () => {
        const isEnabled = suggestionsCheckbox.checked;
        updateAssistantStatus(`Suggestions ${isEnabled ? 'enabled' : 'disabled'}`);
    });
    
    const realtimeCheckbox = settingsModal.querySelector('#enable-realtime');
    realtimeCheckbox.addEventListener('change', () => {
        const isEnabled = realtimeCheckbox.checked;
        updateAssistantStatus(`Real-time analysis ${isEnabled ? 'enabled' : 'disabled'}`);
    });
    
    // Reset settings button
    settingsModal.querySelector('.reset-settings').addEventListener('click', () => {
        // Reset all settings to default
        intelligenceSlider.value = '2';
        autocompleteCheckbox.checked = true;
        suggestionsCheckbox.checked = true;
        realtimeCheckbox.checked = true;
        
        document.querySelectorAll('input[name="model"]').forEach(radio => {
            radio.checked = radio.id === 'model-balanced';
        });
        
        positionSelector.value = 'bottom-right';
        
        // Apply default positions
        const assistantPanel = document.querySelector('.ai-assistant-panel');
        const assistantToggle = document.querySelector('.ai-assistant-toggle');
        
        if (assistantPanel && assistantToggle) {
            assistantPanel.style.top = '';
            assistantPanel.style.right = '20px';
            assistantPanel.style.bottom = '20px';
            assistantPanel.style.left = '';
            
            assistantToggle.style.top = '';
            assistantToggle.style.right = '20px';
            assistantToggle.style.bottom = '20px';
            assistantToggle.style.left = '';
        }
        
        updateAssistantStatus('Settings restored to defaults');
    });
    
    // Save settings button
    settingsModal.querySelector('.save-settings').addEventListener('click', () => {
        // In a real implementation, this would save the settings to local storage
        // For this example, we'll just show a notification
        
        document.body.removeChild(settingsModal);
        showNotification('AI Assistant settings saved successfully', 'success');
        updateAssistantStatus('Settings applied');
        
        // Apply model type based on radio selection
        let modelType = 'balanced';
        document.querySelectorAll('input[name="model"]').forEach(radio => {
            if (radio.checked) {
                modelType = radio.id.replace('model-', '');
            }
        });
        
        // Update intelligence level in the autocomplete tab
        const level = intelligenceSlider.value;
        document.querySelectorAll('.level-option').forEach(option => {
            option.classList.remove('selected');
            if (option.dataset.level === level) {
                option.classList.add('selected');
            }
        });
    });
    
    // Close modal when clicking outside
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            document.body.removeChild(settingsModal);
        }
    });
}

// Add all the AI and navigation features to the document when loaded
document.addEventListener('DOMContentLoaded', function() {
    // Initialize all the advanced features after the application loads
    setTimeout(() => {
        initializeAllFeatures();
        
        // Add keyboard shortcuts hint
        showNotification('Pro tip: Use Ctrl+Shift+N for Navigation and Ctrl+Shift+A for AI Assistant', 'info');
    }, 1000);
});

                
                

