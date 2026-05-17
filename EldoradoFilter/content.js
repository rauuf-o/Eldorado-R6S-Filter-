// content.js

// 1. Inject Audio Interceptor into the Main Page Context
// This is necessary to intercept the HTML5 Audio API because content scripts
// run in an isolated world and cannot directly override window objects of the main page.
const script = document.createElement('script');
script.textContent = `
  const originalAudioPlay = window.HTMLAudioElement.prototype.play;
  
  window.__eldoradoSettings = { enableSounds: true };
  window.__eldoradoLastBlockedTime = 0;

  // Listen for configuration updates or sound block signals from our content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'ELDORADO_UPDATE_SETTINGS') {
      window.__eldoradoSettings = event.data.settings;
    } else if (event.data && event.data.type === 'ELDORADO_BLOCK_SOUND') {
      window.__eldoradoLastBlockedTime = Date.now();
    }
  });

  // Override the native audio play method
  window.HTMLAudioElement.prototype.play = async function() {
    // If the user has disabled all sounds via the extension popup
    if (!window.__eldoradoSettings.enableSounds) {
      console.log('[Eldorado Filter] Sound globally disabled.');
      return Promise.resolve();
    }
    
    // We introduce a tiny 100ms delay. This gives the content script's MutationObserver
    // a chance to detect the newly added DOM element, evaluate it, and post the 
    // 'ELDORADO_BLOCK_SOUND' message if it's a hidden console order.
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // If a blocked order was detected within the last 200ms, suppress this sound
    const timeSinceLastBlock = Date.now() - window.__eldoradoLastBlockedTime;
    if (timeSinceLastBlock < 200) { 
      console.log('[Eldorado Filter] Sound suppressed for hidden order.');
      return Promise.resolve();
    }
    
    // Otherwise, play the sound normally
    return originalAudioPlay.apply(this, arguments);
  };
`;
(document.head || document.documentElement).appendChild(script);
script.remove();


// 2. State & Settings Management
// Regular expressions with word boundaries where appropriate to avoid false positives
const psRegex = /(playstation|ps\s*4|ps\s*5)/i;
const xboxRegex = /xbox/i;
const pcRegex = /(pc|steam|windows|battlenet|bnet|epic|desktop)/i;

let currentSettings = {
  showPC: true,
  showPS: false,
  showXbox: false,
  enableSounds: true,
  pitchTemplate: "Hey! 👋 Thank you for choosing us! 🏆\n\nI've just reviewed your order details, and I can start your boost immediately! Here is your custom package:\n\n🎮 Total Games: [GAMES] Wins\n💰 Special Price: $[PRICE]\n\n🔥 Why Choose Us?\n✅ Top 500 Champion Boosters\n✅ 90%+ Win Rate (Fast & Safe)\n✅ Safe Play: Premium VPN + Offline Mode\n✅ Real-time progress updates in chat!\n\nWe are ready to start right now. If everything looks good, please confirm the order and we will jump on instantly! 🚀 Let us know if you have any questions! Let's get those wins! 💪",
  priceCop: 0.8,
  priceBro: 1.0,
  priceSil: 1.2,
  priceGol: 1.5,
  pricePlat: 2.0,
  priceEme: 2.5,
  priceDia: 3.5,
  priceChamp: 5.0
};

function updateSettings(settings) {
  currentSettings = { ...currentSettings, ...settings };
  
  // Notify the injected script about the new settings
  window.postMessage({
    type: 'ELDORADO_UPDATE_SETTINGS',
    settings: currentSettings
  }, '*');
  
  // Re-process the UI whenever settings change
  processAllOrders();
}

// Load initial settings
chrome.storage.sync.get(currentSettings, updateSettings);

// Listen for setting changes from the popup
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    const newSettings = {};
    for (const [key, { newValue }] of Object.entries(changes)) {
      newSettings[key] = newValue;
    }
    updateSettings(newSettings);
  }
});


// 3. Core Logic for Filtering Orders
// Try to find the closest parent element that represents the order "card" or "row"
function getCardElement(el) {
  let current = el;
  
  // 1st Pass: Eldorado offer cards are almost always clickable links.
  // HTML rules forbid nesting <a> tags, so an <a> tag will NEVER be the list container.
  // This guarantees we perfectly isolate the individual order and not the whole page.
  while (current && current !== document.body && current !== document.documentElement) {
    if (current.nodeName === 'A') {
      return current;
    }
    current = current.parentElement;
  }

  // 2nd Pass: Safe fixed-level fallback
  // If there is no anchor tag for some reason, we climb exactly 4 levels.
  // Text is deeply nested, so 4 levels up gets the card but not the whole list.
  current = el;
  for (let i = 0; i < 4; i++) {
    if (current.parentElement && current.parentElement !== document.body && current.parentElement !== document.documentElement) {
      current = current.parentElement;
    }
  }
  
  return current;
}

function processAllOrders() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
  let node;
  
  // Gather all unique cards first to prevent evaluating the same card multiple times
  // and to ensure we check the FULL text of the card.
  const cardsToProcess = new Set();
  
  while ((node = walker.nextNode())) {
    const text = node.nodeValue;
    // Fast check to see if this text node contains any keywords
    if (psRegex.test(text) || xboxRegex.test(text) || pcRegex.test(text)) {
      const card = getCardElement(node.parentElement);
      if (card) cardsToProcess.add(card);
    }
  }
  
  // Now evaluate each unique card based on its complete text content
  for (const card of cardsToProcess) {
    const fullText = card.textContent || '';
    const isPS = psRegex.test(fullText);
    const isXbox = xboxRegex.test(fullText);
    const isPC = pcRegex.test(fullText);
    
    const isNew = !card.dataset.eldoradoAudioProcessed;
    card.dataset.eldoradoAudioProcessed = 'true';
    
    let shouldShow = false;
    
    // Show the card if it matches any of the platforms enabled in settings
    if (isPC && currentSettings.showPC) shouldShow = true;
    if (isPS && currentSettings.showPS) shouldShow = true;
    if (isXbox && currentSettings.showXbox) shouldShow = true;
    
    if (!shouldShow) {
      if (card.style.display !== 'none') {
        card.style.display = 'none'; // Hide the card
        
        // If this is a newly added card, tell the audio interceptor to block the notification sound
        if (isNew) {
          window.postMessage({ type: 'ELDORADO_BLOCK_SOUND' }, '*');
        }
      }
    } else {
      if (card.style.display === 'none') {
        card.style.display = ''; // Show the card
      }
      
      // Inject professional custom styling to make each card look separated, clean and pro!
      card.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
      card.style.margin = '16px 0'; // Clean vertical separation spacing
      card.style.borderRadius = '12px'; // Sleek rounded corners
      card.style.border = '1px solid #334155'; // Thin elegant border
      card.style.background = 'linear-gradient(135deg, #1e293b, #0f172a)'; // Modern slate dark gradient
      card.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.15)'; // High-end drop shadow
      card.style.padding = '16px'; // Generous breathing room
      card.style.display = 'block'; // Make it behave like a clean flex block
      card.style.position = 'relative';
      card.style.overflow = 'hidden';
      
      // Distinct left accent color line representing the platform status
      let accentColor = '#6366f1'; // Indigo
      if (isPC) accentColor = '#10b981'; // Green for PC
      if (isPS) accentColor = '#3b82f6'; // PlayStation Blue
      if (isXbox) accentColor = '#22c55e'; // Xbox Green
      
      card.style.borderLeft = `6px solid ${accentColor}`; // Solid accent strip
      
      // Hover micro-animations
      card.onmouseenter = () => {
        card.style.transform = 'translateY(-3px)';
        card.style.boxShadow = '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.3)';
        card.style.borderColor = accentColor;
      };
      card.onmouseleave = () => {
        card.style.transform = 'translateY(0)';
        card.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.15)';
        card.style.borderColor = '#334155';
      };
      
      // Auto-reply logic for PC orders that we are showing
      if (isPC) {
        // 1. Auto-Clipboard trick: If this is a brand new order, try to copy the pitch automatically.
        if (isNew && document.hasFocus()) {
          try {
            navigator.clipboard.writeText(currentSettings.pitchTemplate);
          } catch(e) {}
        }
        
        // 3. Quick Pitch Button Injection
        if (!card.dataset.quickPitchInjected) {
          card.dataset.quickPitchInjected = 'true';
          
          const pitchContainer = document.createElement('div');
          pitchContainer.style.cssText = 'padding: 8px 0 0 0; text-align: center;';
          
          const pitchBtn = document.createElement('button');
          pitchBtn.innerHTML = '⚡ Quick Pitch';
          pitchBtn.style.cssText = `
            background-color: #38a169;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 8px;
            font-weight: 800;
            cursor: pointer;
            width: 100%;
            transition: all 0.2s ease;
            box-shadow: 0 4px 6px rgba(16, 185, 129, 0.2);
            text-transform: uppercase;
            font-size: 11px;
            letter-spacing: 1px;
            margin-top: 8px;
          `;
          
          pitchBtn.onmouseover = () => pitchBtn.style.backgroundColor = '#2b7a4b';
          pitchBtn.onmouseout = () => pitchBtn.style.backgroundColor = '#38a169';
          
          pitchBtn.addEventListener('click', (e) => {
            // Set flags in chrome.storage.local
            chrome.storage.local.set({ 
              eldorado_auto_pitch: currentSettings.pitchTemplate,
              calculate_r6_rp: true
            });
            
            // Start hunting for the R6S Order Details on the next page
            startR6Tracker(currentSettings.pitchTemplate);
          });
          
          pitchContainer.appendChild(pitchBtn);
          card.appendChild(pitchContainer);
        }
      }
    }
  }
}

// --- R6S RP Tracker (Runs on Order Details Page) ---
function startR6Tracker(template) {
  let attempts = 0;
  const r6Interval = setInterval(() => {
    attempts++;
    
    // If closed explicitly in view-only mode, exit early
    if (window.__eldoradoBreakdownClosed && !template) {
      clearInterval(r6Interval);
      return;
    }
    
    const fullText = document.body.innerText || '';
    const currentRankMatch = fullText.match(/Current Rank\s*([a-zA-Z]+(?:\s*[IV]+)?|Champion)/i);
    const currentRpMatch = fullText.match(/Current RP\s*(\d+)/i);
    const rpGainMatch = fullText.match(/RP gain per win\s*(\d+)/i);
    const desiredRankMatch = fullText.match(/Desired Rank\s*([a-zA-Z]+(?:\s*[IV]+)?|Champion)/i);
    
    if (currentRankMatch && currentRpMatch && rpGainMatch && desiredRankMatch) {
      clearInterval(r6Interval);
      chrome.storage.local.remove('calculate_r6_rp');
      
      let rankBreakdown = [];
      let totalGamesNeeded = 0;
      
      const rankTiers = ["copper", "bronze", "silver", "gold", "platinum", "emerald", "diamond"];
      const rankDivs = { "v": 0, "iv": 1, "iii": 2, "ii": 3, "i": 4 };
      
      function getBaseRP(rankStr) {
        rankStr = rankStr.toLowerCase().trim();
        if (rankStr === "champion") return 3500;
        const parts = rankStr.split(/\s+/);
        if (parts.length >= 2) {
          const tier = parts[0];
          const div = parts[1];
          const tierIdx = rankTiers.indexOf(tier);
          const divIdx = rankDivs[div];
          if (tierIdx !== -1 && divIdx !== undefined) {
            return (tierIdx * 500) + (divIdx * 100);
          }
        }
        return null;
      }
      
      const currentBase = getBaseRP(currentRankMatch[1]);
      const desiredBase = getBaseRP(desiredRankMatch[1]);
      const currentRp = parseInt(currentRpMatch[1]);
      const rpGain = parseInt(rpGainMatch[1]);
      
      if (currentBase !== null && desiredBase !== null && rpGain > 0) {
        let currentTotalRP = currentBase + currentRp;
        let desiredTotalRP = desiredBase;
        
        if (currentTotalRP < desiredTotalRP) {
          const limits = [
            { name: 'Copper', limit: 500 },
            { name: 'Bronze', limit: 1000 },
            { name: 'Silver', limit: 1500 },
            { name: 'Gold', limit: 2000 },
            { name: 'Platinum', limit: 2500 },
            { name: 'Emerald', limit: 3000 },
            { name: 'Diamond', limit: 3500 },
            { name: 'Champion', limit: Infinity }
          ];
          
          let tempRP = currentTotalRP;
          for (const tier of limits) {
            if (tempRP >= desiredTotalRP) break;
            if (tempRP < tier.limit) {
              const targetRPForThisTier = Math.min(desiredTotalRP, tier.limit);
              const rpNeededInThisTier = targetRPForThisTier - tempRP;
              const gamesInThisTier = Math.ceil(rpNeededInThisTier / rpGain);
              
              if (gamesInThisTier > 0) {
                // Determine price for this tier
                let tierPrice = currentSettings.priceBro;
                if (tier.name === 'Copper') tierPrice = currentSettings.priceCop;
                if (tier.name === 'Bronze') tierPrice = currentSettings.priceBro;
                if (tier.name === 'Silver') tierPrice = currentSettings.priceSil;
                if (tier.name === 'Gold') tierPrice = currentSettings.priceGol;
                if (tier.name === 'Platinum') tierPrice = currentSettings.pricePlat;
                if (tier.name === 'Emerald') tierPrice = currentSettings.priceEme;
                if (tier.name === 'Diamond') tierPrice = currentSettings.priceDia;
                if (tier.name === 'Champion') tierPrice = currentSettings.priceChamp;
                
                const cost = gamesInThisTier * tierPrice;
                
                rankBreakdown.push({
                  name: tier.name,
                  games: gamesInThisTier,
                  cost: cost
                });
                totalGamesNeeded += gamesInThisTier;
              }
              tempRP += gamesInThisTier * rpGain;
            }
          }
        }
      }
      
      let finalPitch = template;
      if (rankBreakdown.length > 0) {
        let totalPrice = 0;
        rankBreakdown.forEach(item => totalPrice += item.cost);
        
        // Create a beautiful UI card for the breakdown
        const breakdownCard = document.createElement('div');
        breakdownCard.className = 'eldorado-r6-breakdown';
        
        let html = `
          <div style="background: linear-gradient(135deg, #1e293b, #0f172a); border: 1px solid #334155; border-radius: 12px; padding: 24px; margin-bottom: 24px; color: #f8fafc; font-family: system-ui, -apple-system, sans-serif; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.15); position: relative;">
            <button class="close-breakdown-btn" style="position: absolute; top: 12px; right: 12px; background: transparent; border: none; color: #94a3b8; font-size: 16px; cursor: pointer; padding: 4px; border-radius: 4px;">✖</button>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; border-bottom: 1px solid #334155; padding-bottom: 12px; padding-right: 20px;">
              <div style="display: flex; align-items: center;">
                <span style="font-size: 24px; margin-right: 12px;">🎮</span>
                <h3 style="margin: 0; font-size: 20px; font-weight: 700; color: #e2e8f0; letter-spacing: 0.5px;">R6S Games Breakdown</h3>
              </div>
              <div style="font-size: 22px; font-weight: 800; color: #10b981;">$${totalPrice.toFixed(2)}</div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px;">
        `;
        
        rankBreakdown.forEach(item => {
          const rank = item.name;
          const games = item.games;
          const cost = item.cost;
          
          let rankColor = '#94a3b8';
          let svgPath = '';
          // Custom SVG shapes for ranks
          if (rank === 'Copper') { rankColor = '#b45309'; svgPath = '<polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>'; }
          if (rank === 'Bronze') { rankColor = '#d97706'; svgPath = '<polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>'; }
          if (rank === 'Silver') { rankColor = '#94a3b8'; svgPath = '<polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>'; }
          if (rank === 'Gold')   { rankColor = '#eab308'; svgPath = '<polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>'; }
          if (rank === 'Platinum') { rankColor = '#06b6d4'; svgPath = '<polygon points="12 2 15 8 22 9 17 14 18 21 12 17 6 21 7 14 2 9 9 8 12 2"/>'; }
          if (rank === 'Emerald') { rankColor = '#10b981'; svgPath = '<polygon points="12 2 22 12 12 22 2 12 12 2"/>'; }
          if (rank === 'Diamond') { rankColor = '#8b5cf6'; svgPath = '<polygon points="12 2 22 12 12 22 2 12 12 2"/>'; }
          if (rank === 'Champion') { rankColor = '#ef4444'; svgPath = '<polygon points="12 2 22 12 12 22 2 12 12 2"/><circle cx="12" cy="12" r="3" fill="#fff"/>'; }
          
          html += `
            <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; border-top: 4px solid ${rankColor}; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative;">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="${rankColor}" stroke="rgba(0,0,0,0.3)" stroke-width="1.5" style="margin-bottom: 8px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
                ${svgPath}
              </svg>
              <div style="font-size: 13px; color: #cbd5e1; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">${rank}</div>
              <div style="font-size: 22px; font-weight: 800; color: #fff;">${games} <span style="font-size: 14px; font-weight: 500; color: #94a3b8;">wins</span></div>
              <div style="font-size: 12px; color: ${rankColor}; margin-top: 4px; font-weight: 600;">+$${cost.toFixed(2)}</div>
            </div>
          `;
        });
        
        html += `
            </div>
            <div style="background: linear-gradient(90deg, #2b7a4b, #38a169); color: white; padding: 14px 20px; border-radius: 8px; font-weight: 700; text-align: center; font-size: 18px; box-shadow: 0 4px 6px rgba(0,0,0,0.2); display: flex; justify-content: space-between; align-items: center;">
              <span>Total Required: ${totalGamesNeeded} Wins</span>
              <span style="background: rgba(0,0,0,0.2); padding: 4px 12px; border-radius: 20px;">Total Price: $${totalPrice.toFixed(2)}</span>
            </div>
          </div>
        `;
        
        breakdownCard.innerHTML = html;
        
        // Remove any existing breakdowns first to prevent duplicates
        document.querySelectorAll('.eldorado-r6-breakdown').forEach(el => el.remove());
        
        // Find the chat box form to inject the UI directly above it
        const chatForm = document.querySelector('.MessageField__text-form') || document.querySelector('form');
        if (chatForm && chatForm.parentElement) {
          chatForm.parentElement.insertBefore(breakdownCard, chatForm);
        } else {
          breakdownCard.style.position = 'fixed';
          breakdownCard.style.top = '20px';
          breakdownCard.style.right = '20px';
          breakdownCard.style.zIndex = '999999';
          breakdownCard.style.width = '400px';
          document.body.appendChild(breakdownCard);
        }

        // Add close button functionality
        const closeBtn = breakdownCard.querySelector('.close-breakdown-btn');
        if (closeBtn) {
          closeBtn.onmouseover = () => closeBtn.style.color = '#ef4444';
          closeBtn.onmouseout = () => closeBtn.style.color = '#94a3b8';
          closeBtn.addEventListener('click', () => {
            window.__eldoradoBreakdownClosed = true;
            breakdownCard.remove();
          });
        }

        if (finalPitch) {
          finalPitch = finalPitch.replace(/\[GAMES\]/g, totalGamesNeeded);
          finalPitch = finalPitch.replace(/\[PRICE\]/g, totalPrice.toFixed(2));
        }
      }
      
      if (finalPitch) {
        chrome.storage.local.set({
          eldorado_auto_pitch: finalPitch,
          calculate_r6_rp: false
        }, () => {
          startChatFinder(finalPitch);
        });
      }
      return;
    }
    
    // Give up finding R6S stats after 10 seconds (20 attempts)
    if (attempts > 20) {
      clearInterval(r6Interval);
      if (template) {
        startChatFinder(template);
      }
    }
  }, 500);
}

// --- Auto-Paste Chat Logic ---
function startChatFinder(text) {
  let attempts = 0;
  window.__eldoradoClickedChat = false;
  
  const chatFinder = setInterval(() => {
    attempts++;
    
    // Step 1: Look for the actual chat input box (ProseMirror, textarea, contenteditable, or input)
    let target = document.querySelector('.ProseMirror');
    if (!target) target = document.querySelector('[contenteditable="true"]');
    if (!target) target = document.querySelector('textarea[placeholder*="message" i], textarea[placeholder*="chat" i], textarea[placeholder*="type" i], textarea[placeholder*="write" i]');
    if (!target) target = document.querySelector('textarea');
    if (!target) target = document.querySelector('input[placeholder*="message" i], input[placeholder*="chat" i], input[placeholder*="type" i]');
    
    // If it grabbed the inner paragraph instead of the contenteditable div, go up one level
    if (target && !target.isContentEditable && target.tagName !== 'TEXTAREA' && target.tagName !== 'INPUT' && target.parentElement && target.parentElement.isContentEditable) {
      target = target.parentElement;
    }
    
    // If we found the input box, type the message!
    if (target && target.offsetParent !== null) {
      // Clear storage and intervals immediately to prevent double writes/sends
      chrome.storage.local.remove('eldorado_auto_pitch');
      clearInterval(chatFinder);

      // Handle standard textareas and inputs (non-contenteditable)
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
        target.focus();
        target.value = text;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Auto-submit standard input using strict KeyboardEvent
        const downEvent = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
        Object.defineProperty(downEvent, 'keyCode', { value: 13 });
        Object.defineProperty(downEvent, 'which', { value: 13 });
        target.dispatchEvent(downEvent);
        
        setTimeout(() => {
          const sendBtn = document.querySelector('.send-button, [class*="send-button" i], button[type="submit"], [aria-label*="send" i], [title*="send" i]');
          if (sendBtn) {
            sendBtn.click();
            sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          }
        }, 100);
        return;
      }

      // Attack 1: Inject Main-World ProseMirror Writer (THE ULTIMATE BYPASS)
      try {
        const scriptContent = `
          (function() {
            let target = document.querySelector('.ProseMirror');
            if (!target) target = document.querySelector('[aria-label*="say something" i], [data-placeholder*="say something" i]');
            if (target && !target.isContentEditable && target.parentElement && target.parentElement.isContentEditable) {
              target = target.parentElement;
            }
            if (!target) return;
            
            let view = null;
            let el = target;
            while (el) {
              if (el.pmViewDesc && el.pmViewDesc.view) {
                view = el.pmViewDesc.view;
                break;
              }
              if (el.__pm_viewDesc && el.__pm_viewDesc.view) {
                view = el.__pm_viewDesc.view;
                break;
              }
              el = el.parentElement;
            }
            
            if (view) {
              // Delete existing empty tags/text, then insert our custom calculated pitch
              const tr = view.state.tr.delete(0, view.state.doc.content.size).insertText(${JSON.stringify(text)});
              view.dispatch(tr);
              view.focus();
            } else {
              // Fallback: execCommand
              target.focus();
              document.execCommand('selectAll', false, null);
              document.execCommand('insertText', false, ${JSON.stringify(text)});
            }
            
            // Auto-Submit: Simulate pressing Enter with defined properties to fool strict framework handlers
            setTimeout(() => {
              const downEvent = new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13
              });
              Object.defineProperty(downEvent, 'keyCode', { value: 13 });
              Object.defineProperty(downEvent, 'which', { value: 13 });
              target.dispatchEvent(downEvent);
              
              const pressEvent = new KeyboardEvent('keypress', {
                bubbles: true,
                cancelable: true,
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13
              });
              Object.defineProperty(pressEvent, 'keyCode', { value: 13 });
              Object.defineProperty(pressEvent, 'which', { value: 13 });
              target.dispatchEvent(pressEvent);
              
              const upEvent = new KeyboardEvent('keyup', {
                bubbles: true,
                cancelable: true,
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13
              });
              Object.defineProperty(upEvent, 'keyCode', { value: 13 });
              Object.defineProperty(upEvent, 'which', { value: 13 });
              target.dispatchEvent(upEvent);
            }, 50);

            // TalkJS Send Button click fallback using high-specificity selectors
            setTimeout(() => {
              const sendBtn = document.querySelector('.send-button, [class*="send-button" i], button[type="submit"], [aria-label*="send" i], [title*="send" i]');
              if (sendBtn) {
                sendBtn.click();
                sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              }
            }, 150);
          })();
        `;
        const script = document.createElement('script');
        script.textContent = scriptContent;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
      } catch(e) {}

      // Attack 2: Native Selection & Cursor placement
      try {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false); // Move cursor to the end
        selection.removeAllRanges();
        selection.addRange(range);
      } catch(e) {}
      
      // Attack 3: Modern contenteditable 'beforeinput' event (standard bypass for ProseMirror/Lexical/React editors)
      try {
        const beforeInputEvt = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text
        });
        target.dispatchEvent(beforeInputEvt);
      } catch(e) {}

      // Attack 4: ExecCommand Emulation
      try {
        document.execCommand('insertText', false, text);
      } catch (e) {}

      // Attack 5: Direct DOM Mutation (ProseMirror's MutationObserver fallback)
      const innerP = target.querySelector('p');
      if (innerP && innerP.textContent.trim() === '') {
        innerP.textContent = text;
        innerP.classList.remove('empty-node');
      } else if (target.isContentEditable && target.textContent.trim() === '') {
        target.textContent = text;
      }

      // Attack 6: Event Spam to force state update
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'a', code: 'KeyA' }));
      target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'a', code: 'KeyA' }));
      
      // Attack 7: Ghost Paste
      try {
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', text);
        const pasteEvent = new ClipboardEvent('paste', {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true
        });
        target.dispatchEvent(pasteEvent);
      } catch(e) {}
      
      return;
    }
    
    // Step 2: If we didn't find the input box, try to find and click the "Chat with buyer" button
    if (!window.__eldoradoClickedChat) {
      const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
      const chatBtn = buttons.find(b => {
        const txt = (b.textContent || '').toLowerCase();
        return (txt.includes('chat') || txt.includes('message')) && b.offsetParent !== null;
      });
      
      if (chatBtn) {
        window.__eldoradoClickedChat = true;
        chatBtn.click();
      }
    }

    // Give up after 15 seconds of searching (30 attempts)
    if (attempts > 30) {
      chrome.storage.local.remove('eldorado_auto_pitch');
      clearInterval(chatFinder);
    }
  }, 500);
}

// 4. Robust throttled observer
let throttleTimer = null;
let pendingProcess = false;

function throttledProcess() {
  if (throttleTimer) {
    pendingProcess = true;
    return;
  }
  
  processAllOrders();
  
  throttleTimer = setTimeout(() => {
    throttleTimer = null;
    if (pendingProcess) {
      pendingProcess = false;
      throttledProcess();
    }
  }, 300); // Max execution rate: Once every 300ms
}

function initializeObserver() {
  const isEldorado = location.hostname.includes('eldorado.gg');

  function checkAndRunViewOnlyBreakdown() {
    if (!isEldorado || window !== window.top) return;
    const isOrderPage = location.pathname.includes('/orders/') || location.pathname.includes('/order/');
    if (isOrderPage) {
      const alreadyHasBreakdown = document.querySelector('.eldorado-r6-breakdown');
      if (!alreadyHasBreakdown && !window.__eldoradoBreakdownClosed) {
        chrome.storage.local.get(['eldorado_auto_pitch'], (res) => {
          if (!res.eldorado_auto_pitch) {
            startR6Tracker(null);
          }
        });
      }
    }
  }

  if (isEldorado) {
    // Initial run
    processAllOrders();
    checkAndRunViewOnlyBreakdown();
  }

  // If we navigated to a new page after clicking Quick Pitch, start the chat finder or R6 Tracker
  chrome.storage.local.get(['eldorado_auto_pitch', 'calculate_r6_rp'], (res) => {
    if (res.eldorado_auto_pitch) {
      if (res.calculate_r6_rp) {
        if (isEldorado && window === window.top) {
          // Only top window performs the R6S stats extraction and pricing calculation
          startR6Tracker(res.eldorado_auto_pitch);
        } else {
          // If we are in an iframe (e.g. Chat iframe), wait until the top window calculations are complete and stored
          const storageListener = (changes, area) => {
            if (area === 'local' && changes.eldorado_auto_pitch && (!changes.calculate_r6_rp || !changes.calculate_r6_rp.newValue)) {
              startChatFinder(changes.eldorado_auto_pitch.newValue);
              chrome.storage.onChanged.removeListener(storageListener);
            }
          };
          chrome.storage.onChanged.addListener(storageListener);
        }
      } else {
        startChatFinder(res.eldorado_auto_pitch);
      }
    }
  });

  if (isEldorado) {
    // Track URL changes to auto-remove the breakdown card when leaving the order page
    let currentUrl = location.href;
    setInterval(() => {
      if (currentUrl !== location.href) {
        currentUrl = location.href;
        window.__eldoradoBreakdownClosed = false; // Reset close state on navigation
        document.querySelectorAll('.eldorado-r6-breakdown').forEach(el => el.remove());
        checkAndRunViewOnlyBreakdown();
      }
    }, 500);

    // Set up a highly aggressive Mutation Observer
    const observer = new MutationObserver(() => {
      throttledProcess();
    });

    // Watch for ANY changes, including React text-node swaps and attribute changes
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true, // Crucial for modern frameworks
      attributes: true
    });

    // Bulletproof fallback interval just in case
    setInterval(processAllOrders, 1500);
  }
}

// Process orders already on the page
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initializeObserver());
} else {
  initializeObserver();
}
