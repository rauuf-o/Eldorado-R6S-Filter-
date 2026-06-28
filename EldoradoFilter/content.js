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
const cs2Regex = /Counter-Strike\s*2|CS2\s*Premier|CS\s*2\s*Premier|CS2\s*Boost/i;

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
  priceChamp: 5.0,
  priceCs2_0_10k: 10.0,
  priceCs2_10_20k: 15.0,
  priceCs2_20_25k: 20.0,
  priceCs2_above25k: 25.0
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
    if (psRegex.test(text) || xboxRegex.test(text) || pcRegex.test(text) || cs2Regex.test(text)) {
      const card = getCardElement(node.parentElement);
      if (card) cardsToProcess.add(card);
    }
  }
  
  // Now evaluate each unique card based on its complete text content
  for (const card of cardsToProcess) {
    // CRITICAL: skip any of our own injected UI elements
    if (card.dataset.eldoradoUi || card.closest('[data-eldorado-ui]')) continue;
    const fullText = card.textContent || '';
    const isPS = psRegex.test(fullText);
    const isXbox = xboxRegex.test(fullText);
    const isPC = pcRegex.test(fullText);
    const isCS2 = cs2Regex.test(fullText);
    
    const isNew = !card.dataset.eldoradoAudioProcessed;
    card.dataset.eldoradoAudioProcessed = 'true';
    
    let shouldShow = false;
    
    // Show the card if it matches any of the platforms enabled in settings
    if (isPC && currentSettings.showPC) shouldShow = true;
    if (isPS && currentSettings.showPS) shouldShow = true;
    if (isXbox && currentSettings.showXbox) shouldShow = true;
    if (isCS2 && currentSettings.showPC) shouldShow = true; // CS2 follows PC toggle
    
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
      if (isCS2) accentColor = '#f59e0b'; // Gold/Amber for CS2
      
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
      
      // Auto-reply logic for PC and CS2 orders that we are showing
      if (isPC || isCS2) {
        // Auto-Clipboard trick: If this is a brand new order, try to copy the pitch automatically.
        if (isPC && isNew && document.hasFocus()) {
          try {
            navigator.clipboard.writeText(currentSettings.pitchTemplate);
          } catch(e) {}
        }
        
        // Quick Pitch Button Injection (works for both R6S and CS2)
        if (!card.dataset.quickPitchInjected) {
          card.dataset.quickPitchInjected = 'true';
          
          const pitchContainer = document.createElement('div');
          pitchContainer.style.cssText = 'padding: 8px 0 0 0; text-align: center;';
          
          const pitchBtn = document.createElement('button');
          
          // Style the button differently for CS2 vs R6S
          const btnColor = isCS2 ? '#d97706' : '#38a169';
          const btnHoverColor = isCS2 ? '#b45309' : '#2b7a4b';
          const btnLabel = isCS2 ? '🔫 CS2 Quick Pitch' : '⚡ Quick Pitch';
          const btnShadowColor = isCS2 ? 'rgba(217, 119, 6, 0.3)' : 'rgba(16, 185, 129, 0.2)';
          
          pitchBtn.innerHTML = btnLabel;
          pitchBtn.style.cssText = `
            background-color: ${btnColor};
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 8px;
            font-weight: 800;
            cursor: pointer;
            width: 100%;
            transition: all 0.2s ease;
            box-shadow: 0 4px 6px ${btnShadowColor};
            text-transform: uppercase;
            font-size: 11px;
            letter-spacing: 1px;
            margin-top: 8px;
          `;
          
          pitchBtn.onmouseover = () => pitchBtn.style.backgroundColor = btnHoverColor;
          pitchBtn.onmouseout = () => pitchBtn.style.backgroundColor = btnColor;
          
          pitchBtn.addEventListener('click', (e) => {
            // Do NOT prevent default - the card link navigates to the order detail page
            // which is where the tracker will find the rating numbers.
            
            // Set flags in chrome.storage.local
            chrome.storage.local.set({ 
              eldorado_auto_pitch: currentSettings.pitchTemplate,
              calculate_r6_rp: !isCS2,
              calculate_cs2_rating: isCS2
            });
            
            // Start the right tracker immediately (will also retry on the detail page via storage flag)
            if (isCS2) {
              startCs2Tracker(currentSettings.pitchTemplate);
            } else {
              startR6Tracker(currentSettings.pitchTemplate);
            }
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
        
        // ALWAYS attach to document.body as a fixed overlay so React cannot destroy it
        // Use setAttribute so !important survives any later style mutations
        breakdownCard.setAttribute('data-eldorado-ui', 'true');
        breakdownCard.setAttribute('style',
          'position:fixed!important;top:20px!important;right:20px!important;' +
          'z-index:2147483647!important;width:420px!important;max-height:85vh!important;overflow-y:auto!important'
        );
        document.body.appendChild(breakdownCard);
        
        // Store the card HTML so it can be re-injected if React wipes it
        window.__eldoradoActiveBreakdownHtml = breakdownCard.outerHTML;
        window.__eldoradoActiveBreakdownClass = 'eldorado-r6-breakdown';

        // Add close button functionality
        const closeBtn = breakdownCard.querySelector('.close-breakdown-btn');
        if (closeBtn) {
          closeBtn.onmouseover = () => closeBtn.style.color = '#ef4444';
          closeBtn.onmouseout = () => closeBtn.style.color = '#94a3b8';
          closeBtn.addEventListener('click', () => {
            window.__eldoradoBreakdownClosed = true;
            window.__eldoradoActiveBreakdownHtml = null;
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

// --- React & Standard Field Setters ---
function setNativeValue(element, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
  const prototype = Object.getPrototypeOf(element);
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  
  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(element, value);
  } else if (valueSetter) {
    valueSetter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

function setSelectValue(element, value) {
  element.value = value;
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

// --- Custom Offer Automation ---
function autoFillAndCreateOffer(totalPrice, deadlineDays, statusCallback) {
  if (statusCallback) statusCallback('Opening form...');
  console.log(`[Eldorado Filter] autoFillAndCreateOffer — $${totalPrice.toFixed(2)}, ${deadlineDays} day(s)`);

  const logDebug = (msg) => {
    console.log('[Eldorado Debug] ' + msg);
    const debugContainers = document.querySelectorAll('.eldorado-debug-logs');
    debugContainers.forEach(c => {
      c.style.display = 'block';
      c.innerHTML += `<div>• ${msg}</div>`;
      c.scrollTop = c.scrollHeight;
    });
  };

  // Helper function to check visibility correctly (supporting position: fixed)
  const isElementVisible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    } catch(e) {}
    return true;
  };

  // ── Step 1: Find & click the "Create Offer" / "Custom Offer" button ───────
  const offerKeywords = ['create offer', 'custom offer', 'send offer', 'make offer', 'place offer', 'counter offer'];
  const btns = Array.from(document.querySelectorAll('button, a, [role="button"]')).filter(el => {
    if (!isElementVisible(el) || el.closest('[data-eldorado-ui]')) return false;
    const t = (el.textContent || '').toLowerCase().trim();
    return t.length < 50 && offerKeywords.some(kw => t.includes(kw));
  }).sort((a, b) => (a.tagName === 'BUTTON' ? -1 : 1));

  if (!btns[0]) {
    if (statusCallback) statusCallback('Offer button not found!');
    console.warn('[Eldorado Filter] No offer button. Visible buttons:', 
      Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t));
    return;
  }

  console.log('[Eldorado Filter] Clicking:', btns[0].textContent.trim());
  btns[0].click();
  btns[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

  // ── Step 2: Wait for the "Create offer" modal to appear ──────────────────
  let attempts = 0;
  const waitForModal = setInterval(() => {
    attempts++;

    let modal = null;

    // Priority 1: role="dialog"
    const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
    for (const d of dialogs) {
      if (!d.closest('[data-eldorado-ui]') && isElementVisible(d) && d.querySelector('input')) {
        modal = d;
        break;
      }
    }

    // Priority 2: scan for a div/section containing "Create offer" title + input
    if (!modal) {
      const allDivs = Array.from(document.querySelectorAll('div, section, aside'));
      for (const el of allDivs) {
        if (el.closest('[data-eldorado-ui]')) continue;
        if (!isElementVisible(el)) continue;
        const directText = Array.from(el.childNodes)
          .filter(n => n.nodeType === Node.TEXT_NODE || (n.nodeType === Node.ELEMENT_NODE && ['H1','H2','H3','H4','H5','H6','SPAN','P'].includes(n.nodeName)))
          .map(n => (n.textContent || '').trim()).join(' ').toLowerCase();
        if ((directText.includes('create offer') || directText.includes('custom offer')) && el.querySelector('input')) {
          if (!modal || el.contains(modal) === false) {
            modal = el;
          }
        }
      }
    }

    // Priority 3: fallback — any visible form with an input
    if (!modal) {
      const forms = Array.from(document.querySelectorAll('form'))
        .filter(f => !f.closest('[data-eldorado-ui]') && isElementVisible(f) && f.querySelector('input'));
      if (forms[0]) modal = forms[0];
    }

    if (!modal) {
      if (attempts > 30) {
        clearInterval(waitForModal);
        if (statusCallback) statusCallback('Modal not found!');
        console.warn('[Eldorado Filter] Gave up waiting for modal.');
      }
      return;
    }

    clearInterval(waitForModal);
    logDebug('Modal found in content script: ' + (modal.className || modal.tagName));

    // ── Step 3: Find the price input ─────────────────────────────────────────
    let priceInput = null;

    // Proximity search: find the input near "Price" label
    let priceLabel = null;
    const allEls = Array.from(modal.querySelectorAll('*'));
    for (const el of allEls) {
      const text = (el.textContent || '').trim();
      if (/^price\s*\$:?$/i.test(text) || /^price:?$/i.test(text)) {
        priceLabel = el;
        logDebug('Found price label with text: ' + text);
        break;
      }
    }
    if (!priceLabel) {
      for (const el of allEls) {
        const text = (el.textContent || '').trim().toLowerCase();
        if (text.includes('price') && text.length < 15) {
          priceLabel = el;
          break;
        }
      }
    }

    if (priceLabel) {
      let parent = priceLabel.parentElement;
      while (parent && parent !== modal) {
        const foundInput = parent.querySelector('input');
        if (foundInput && isElementVisible(foundInput)) {
          priceInput = foundInput;
          break;
        }
        parent = parent.parentElement;
      }
    }

    // Fallback: search by attributes
    if (!priceInput) {
      const allInputs = Array.from(modal.querySelectorAll('input'))
        .filter(el => isElementVisible(el) && !el.closest('[data-eldorado-ui]'));

      priceInput = allInputs.find(el => {
        const type = (el.getAttribute('type') || '').toLowerCase();
        const name = (el.getAttribute('name') || '').toLowerCase();
        const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
        const className = (el.className || '').toLowerCase();
        return type === 'number' || 
               name.includes('price') || 
               placeholder.includes('price') || 
               className.includes('price') ||
               className.includes('amount');
      });

      if (!priceInput) {
        priceInput = allInputs.find(el => {
          const type = (el.getAttribute('type') || '').toLowerCase();
          return type === 'number' || type === 'text' || !type;
        });
      }

      if (!priceInput) {
        priceInput = allInputs[0];
      }
    }

    if (!priceInput) {
      if (statusCallback) statusCallback('Price field not found!');
      console.warn('[Eldorado Filter] No input found in modal.');
      return;
    }

    console.log('[Eldorado Filter] Price input found:', priceInput.outerHTML.slice(0, 120));

    // ── Step 4: Fill price via chrome.scripting.executeScript (world: MAIN) ──
    // Script-tag injection is blocked by the site's CSP. In MV3 we use
    // chrome.scripting.executeScript with world:'MAIN' which is CSP-exempt.
    const priceValue = totalPrice.toFixed(2);
    const priceInt   = String(Math.round(totalPrice));

    const fillPriceInMainWorld = (targetDecimal, targetInt) => {
      // This function runs in the MAIN world (Angular's world).
      try {
        const TARGET_VALUE = targetDecimal;
        const TARGET_INT   = targetInt;

        // ── Find the price input ─────────────────────────────────────────────
        // Confirmed from page inspection: aria-label="Numeric input field"
        let input = document.querySelector('input[aria-label="Numeric input field"]');
        console.log('[Eldorado] aria-label search:', input ? 'FOUND' : 'not found');

        if (!input) {
          input = Array.from(document.querySelectorAll('input[inputmode="decimal"], input[inputmode="numeric"]'))
            .find(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
          console.log('[Eldorado] inputmode search:', input ? 'FOUND' : 'not found');
        }
        if (!input) {
          const dialog = document.querySelector('[role="dialog"]');
          if (dialog) {
            input = Array.from(dialog.querySelectorAll('input'))
              .find(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
          }
          console.log('[Eldorado] dialog fallback:', input ? 'FOUND' : 'not found');
        }
        if (!input) { console.warn('[Eldorado] NO INPUT FOUND'); return; }

        console.log('[Eldorado] Target input:', input.outerHTML.slice(0, 150));
        console.log('[Eldorado] Current value:', JSON.stringify(input.value));

        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;

        function tryFill(el, val, label) {
          el.click();
          el.focus();
          // A) execCommand — gold standard, triggers Angular's zone
          el.select();
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
          const ok = document.execCommand('insertText', false, val);
          console.log('[Eldorado]', label, 'execCommand:', ok, '→', JSON.stringify(el.value));
          if (ok && el.value === val) return true;
          // B) Native setter + InputEvent
          nativeSetter.call(el, '');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          nativeSetter.call(el, val);
          el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: val }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          console.log('[Eldorado]', label, 'nativeSetter →', JSON.stringify(el.value));
          return el.value === val;
        }

        // Attempt 1 — immediate
        let ok = tryFill(input, TARGET_VALUE, 'sync');
        if (!ok) ok = tryFill(input, TARGET_INT, 'sync-int');
        console.log('[Eldorado] Sync fill:', ok, JSON.stringify(input.value));

        // Attempt 2 — 150ms (after Angular change-detection tick)
        window.setTimeout(() => {
          if (input.value === TARGET_VALUE || input.value === TARGET_INT) {
            console.log('[Eldorado] t=150ms already correct:', input.value);
            return;
          }
          console.log('[Eldorado] t=150ms value reset to', JSON.stringify(input.value), '— retrying');
          let ok2 = tryFill(input, TARGET_VALUE, '150ms');
          if (!ok2) ok2 = tryFill(input, TARGET_INT, '150ms-int');

          // Attempt 3 — 500ms (final)
          window.setTimeout(() => {
            console.log('[Eldorado] t=500ms final value:', JSON.stringify(input.value));
            if (input.value !== TARGET_VALUE && input.value !== TARGET_INT) {
              tryFill(input, TARGET_VALUE, '500ms');
              if (input.value !== TARGET_VALUE) tryFill(input, TARGET_INT, '500ms-int');
            }
          }, 350);
        }, 150);

      } catch(e) {
        console.error('[Eldorado] fillPrice error:', e.message);
      }
    };

    // chrome.scripting.executeScript is available in MV3 content scripts
    if (typeof chrome !== 'undefined' && chrome.scripting && chrome.scripting.executeScript) {
      chrome.scripting.executeScript({
        target: { tabId: chrome.devtools?.inspectedWindow?.tabId || -1 },
        world: 'MAIN',
        func: fillPriceInMainWorld,
        args: [priceValue, priceInt]
      }).then(() => {
        console.log('[Eldorado Filter] executeScript dispatched');
      }).catch(err => {
        console.warn('[Eldorado Filter] executeScript failed:', err.message, '— falling back to content script fill');
        // Fallback: run directly in content script (isolated world)
        // Events fired from isolated world still propagate to Angular's listeners
        fillPriceInMainWorld(priceValue, priceInt);
      });
    } else {
      // Fallback for environments where scripting API isn't available
      console.warn('[Eldorado Filter] chrome.scripting not available — using content script fill');
      fillPriceInMainWorld(priceValue, priceInt);
    }

    if (statusCallback) statusCallback('Filling price...');

    // ── Step 5: Handle "Delivery time" dropdown ────────────────────────
    // Delay until after all price fill attempts are complete (~550ms)
    setTimeout(() => {
      // Try native select first
      const nativeSelect = modal.querySelector('select');
      if (nativeSelect) {
        console.log('[Eldorado Filter] Found native select element');
        const options = Array.from(nativeSelect.options);
        let bestOption = options.find(o => {
          const t = o.textContent.toLowerCase().trim();
          return t.includes(`${deadlineDays} day`) || t === `${deadlineDays}`;
        });
        if (!bestOption) {
          bestOption = options.find(o => {
            const n = parseInt(o.textContent.match(/\d+/)?.[0]);
            return !isNaN(n) && n >= deadlineDays;
          });
        }
        if (!bestOption && options.length > 0) {
          bestOption = options[options.length - 1];
        }
        if (bestOption) {
          console.log('[Eldorado Filter] Selecting native option:', bestOption.textContent);
          nativeSelect.value = bestOption.value;
          nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
          nativeSelect.dispatchEvent(new Event('blur', { bubbles: true }));
          if (statusCallback) statusCallback('✅ Filled! Review & send');
          return;
        }
      }

      // If not native select, try custom dropdown trigger
      let dropdownTrigger = null;

      // Find "Delivery time" label or text to locate its corresponding control
      let deliveryLabel = null;
      const allElements = Array.from(modal.querySelectorAll('*'));
      for (const el of allElements) {
        const text = (el.textContent || '').trim();
        if (/^delivery\s*time:?$/i.test(text)) {
          deliveryLabel = el;
          break;
        }
      }
      if (!deliveryLabel) {
        for (const el of allElements) {
          const text = (el.textContent || '').trim().toLowerCase();
          if (text.includes('delivery') && text.length < 30) {
            deliveryLabel = el;
            break;
          }
        }
      }

      if (deliveryLabel) {
        let parent = deliveryLabel.parentElement;
        while (parent && parent !== modal) {
          const trigger = parent.querySelector('button, [role="button"], [role="combobox"]');
          if (trigger && trigger !== deliveryLabel && isElementVisible(trigger)) {
            dropdownTrigger = trigger;
            break;
          }
          const customDiv = parent.querySelector('div[class*="select" i], div[class*="dropdown" i], div[class*="control" i]');
          if (customDiv && customDiv !== deliveryLabel && isElementVisible(customDiv)) {
            dropdownTrigger = customDiv;
            break;
          }
          parent = parent.parentElement;
        }
      }

      // Fallback: search for "Select an option" or similar text
      if (!dropdownTrigger) {
        const allClickables = Array.from(modal.querySelectorAll('button, div, span, [role="button"], [role="combobox"]'))
          .filter(el => isElementVisible(el) && !el.closest('[data-eldorado-ui]'));
        dropdownTrigger = allClickables.find(el => {
          const t = (el.textContent || '').toLowerCase().trim();
          return t.includes('select an option') || t.includes('select option') || t.includes('select...');
        });
      }

      if (!dropdownTrigger) {
        console.warn('[Eldorado Filter] Delivery dropdown trigger not found. Price was filled.');
        if (statusCallback) statusCallback('✅ Price filled! Set delivery manually');
        return;
      }

      console.log('[Eldorado Filter] Clicking delivery dropdown:', dropdownTrigger.textContent.trim());
      dropdownTrigger.click();
      dropdownTrigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      // ── Step 6: Pick the right delivery option ──────────────────────────────
      let optionAttempts = 0;
      const findAndClickOption = () => {
        optionAttempts++;
        const allElementsOnPage = Array.from(document.querySelectorAll('div, li, button, [role="option"], span, a'));
        const allVisible = allElementsOnPage.filter(el => {
          if (!isElementVisible(el) || el.closest('[data-eldorado-ui]')) return false;
          const text = (el.textContent || '').trim();
          return text.length > 0 && text.length < 30;
        });

        let bestOption = null;
        let bestScore = -1;

        for (const el of allVisible) {
          const text = el.textContent.trim().toLowerCase();
          const match = text.match(/(\d+)\s*(day|hour|d|h)s?/i);
          let valueDays = null;
          if (match) {
            const val = parseInt(match[1], 10);
            const unit = match[2].toLowerCase();
            if (unit.startsWith('h')) {
              valueDays = val / 24;
            } else {
              valueDays = val;
            }
          } else {
            const plainNumMatch = text.match(/^\d+$/);
            if (plainNumMatch) {
              valueDays = parseInt(plainNumMatch[0], 10);
            }
          }

          if (valueDays !== null) {
            let matchScore = 0;
            if (valueDays === deadlineDays) {
              matchScore = 100;
            } else if (valueDays > deadlineDays) {
              matchScore = 50 - (valueDays - deadlineDays);
            } else {
              matchScore = 1;
            }

            let contextScore = 0;
            if (el.getAttribute('role') === 'option') contextScore += 50;
            const nearestListbox = el.closest('[role="listbox"], [role="menu"], [role="presentation"]');
            if (nearestListbox) contextScore += 40;

            let hasDropdownClass = false;
            let curr = el;
            while (curr && curr !== document.body) {
              const className = (curr.className || '').toString().toLowerCase();
              if (className.includes('select') || 
                  className.includes('menu') || 
                  className.includes('dropdown') || 
                  className.includes('option') || 
                  className.includes('portal') || 
                  className.includes('popup') ||
                  className.includes('listbox')) {
                hasDropdownClass = true;
                break;
              }
              curr = curr.parentElement;
            }
            if (hasDropdownClass) contextScore += 30;
            if (modal && modal.contains(el)) contextScore += 20;

            const tag = el.tagName.toLowerCase();
            if (tag === 'li' || tag === 'button' || tag === 'option') contextScore += 15;

            try {
              const style = window.getComputedStyle(el);
              if (style.position === 'absolute' || style.position === 'fixed') contextScore += 10;
            } catch(e) {}

            let isBackground = false;
            let parent = el.parentElement;
            while (parent && parent !== document.body) {
              if (parent.tagName === 'A' || (parent.className || '').toString().toLowerCase().includes('card')) {
                if (modal && modal.contains(parent)) {
                  // not background
                } else {
                  isBackground = true;
                  break;
                }
              }
              parent = parent.parentElement;
            }
            if (isBackground) contextScore -= 60; // Penalize background cards heavily

            const totalScore = matchScore + contextScore;
            if (totalScore > bestScore && matchScore > 0) {
              bestScore = totalScore;
              bestOption = el;
            }
          }
        }

        if (bestOption && bestScore >= 70) {
          console.log('[Eldorado Filter] Selecting delivery option:', bestOption.textContent.trim(), 'score:', bestScore);
          bestOption.click();
          bestOption.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          if (statusCallback) statusCallback('✅ Filled! Review & send');
        } else {
          if (optionAttempts < 15) {
            console.log('[Eldorado Filter] Dropdown options not fully ready or scored low. Retrying... (Attempt ' + optionAttempts + ')');
            setTimeout(findAndClickOption, 150);
          } else {
            console.warn('[Eldorado Filter] Failed to find a highly scored delivery option after retries.');
            if (statusCallback) statusCallback('✅ Price filled! Set delivery manually');
          }
        }
      };

      setTimeout(findAndClickOption, 250);
    }, 300);

  }, 600);
}

// --- CS2 Premier Boosting Tracker ---
function startCs2Tracker(template) {
  let attempts = 0;
  console.log(`[Eldorado Filter] CS2 tracker started. Template present: ${!!template}`);

  // Show a floating status badge immediately so the user can see the tracker is running
  let statusBadge = document.getElementById('eldorado-cs2-status');
  if (!statusBadge) {
    statusBadge = document.createElement('div');
    statusBadge.id = 'eldorado-cs2-status';
    statusBadge.style.cssText = [
      'position:fixed', 'bottom:20px', 'right:20px', 'z-index:999999',
      'background:linear-gradient(135deg,#271a0c,#1a1206)',
      'border:1px solid #d97706', 'border-radius:10px',
      'padding:10px 16px', 'color:#fbbf24',
      'font-family:system-ui,sans-serif', 'font-size:13px', 'font-weight:700',
      'box-shadow:0 4px 12px rgba(0,0,0,0.5)',
      'display:flex', 'align-items:center', 'gap:8px',
      'pointer-events:none'
    ].join(';');
    document.body.appendChild(statusBadge);
  }
  const updateBadge = (msg) => { if (statusBadge) statusBadge.innerHTML = `🔫 CS2: ${msg}`; };
  const removeBadge = () => { if (statusBadge) { statusBadge.remove(); statusBadge = null; } };
  updateBadge('Scanning page...');

  // Helper to extract rating numbers robustly using keyword proximity
  function extractRatingFromCorpus(corpus, keywords) {
    corpus = corpus.toLowerCase();
    for (const kw of keywords) {
      const idx = corpus.indexOf(kw);
      if (idx !== -1) {
        // Get the next 150 characters to search for the rating number
        const sub = corpus.slice(idx + kw.length, idx + kw.length + 150);
        // Find all digit groups (possibly separated by space, dot, or comma)
        const matches = sub.match(/\d+(?:[\s,.]\d+)*/g);
        if (matches) {
          let candidate = null;
          for (const m of matches) {
            const cleaned = m.replace(/[\s,.]/g, '');
            const val = parseInt(cleaned, 10);
            if (!isNaN(val)) {
              // Prefer a large number that looks like a CS2 rating (>= 100)
              if (val >= 100) {
                console.log(`[Eldorado Filter] CS2 Rating Found (>=100): ${val} for keyword: "${kw}"`);
                return val;
              }
              if (candidate === null) {
                candidate = val;
              }
            }
          }
          if (candidate !== null) {
            console.log(`[Eldorado Filter] CS2 Rating Found (fallback): ${candidate} for keyword: "${kw}"`);
            return candidate;
          }
        }
      }
    }
    return null;
  }

  const cs2Interval = setInterval(() => {
    attempts++;
    
    if (window.__eldoradoBreakdownClosed && !template) {
      clearInterval(cs2Interval);
      removeBadge();
      return;
    }
    
    updateBadge(`Scanning... (${attempts})`);

    // Build a search corpus from BOTH visible text AND all input/select values
    const visibleText = document.body.innerText || '';
    const inputValues = Array.from(document.querySelectorAll('input, textarea, select'))
      .map(el => {
        const label = el.labels?.[0]?.textContent || el.placeholder || el.name || '';
        const val = el.value || '';
        return `${label}: ${val}`;
      }).join('\n');
    const searchCorpus = visibleText + '\n' + inputValues;

    if (attempts === 1 || attempts % 5 === 0) {
      console.log(`[Eldorado Filter] CS2 Scanner attempts: ${attempts}`);
      console.log(`[Eldorado Filter] visibleText (first 500 chars):\n${visibleText.slice(0, 500)}`);
      console.log(`[Eldorado Filter] inputValues:\n${inputValues}`);
    }

    const currentKeywords = ['enter your current rating', 'current rating', 'starting rating', 'start rating', 'current premier', 'current cs2', 'rating from', 'from rating', 'current:', 'current'];
    const desiredKeywords = ['enter your desired rating', 'desired rating', 'target rating', 'desired premier', 'desired cs2', 'rating to', 'to rating', 'desired:', 'desired'];

    const currentRating = extractRatingFromCorpus(searchCorpus, currentKeywords);
    const desiredRating = extractRatingFromCorpus(searchCorpus, desiredKeywords);
    
    if (currentRating !== null && desiredRating !== null && desiredRating > currentRating) {
      clearInterval(cs2Interval);
      chrome.storage.local.remove('calculate_cs2_rating');
      updateBadge(`Found: ${currentRating} → ${desiredRating}`);
      console.log(`[Eldorado Filter] CS2 ratings determined successfully: ${currentRating} to ${desiredRating}`);
      
      // Calculate progressive pricing
      let totalPrice = 0;
      const tiers = [
        { start: 0, end: 10000, price: currentSettings.priceCs2_0_10k, name: '0k - 10k' },
        { start: 10000, end: 20000, price: currentSettings.priceCs2_10_20k, name: '10k - 20k' },
        { start: 20000, end: 25000, price: currentSettings.priceCs2_20_25k, name: '20k - 25k' },
        { start: 25000, end: Infinity, price: currentSettings.priceCs2_above25k, name: 'Above 25k' }
      ];
      
      let breakdown = [];
      
      tiers.forEach(tier => {
        const overlapStart = Math.max(currentRating, tier.start);
        const overlapEnd = Math.min(desiredRating, tier.end);
        
        if (overlapStart < overlapEnd) {
          const ratingInTier = overlapEnd - overlapStart;
          const costInTier = (ratingInTier / 1000) * tier.price;
          totalPrice += costInTier;
          breakdown.push({
            name: tier.name,
            rating: ratingInTier,
            cost: costInTier,
            rate: tier.price
          });
        }
      });
      
      // Calculate deadline
      const ratingDiff = desiredRating - currentRating;
      let deadlineDays = 1;
      if (ratingDiff > 5000) {
        deadlineDays = 3;
      } else if (ratingDiff > 3000) {
        deadlineDays = 2;
      }
      
      // Inject CS2 Breakdown Card UI
      const breakdownCard = document.createElement('div');
      breakdownCard.className = 'eldorado-cs2-breakdown';
      
      let html = `
        <div style="background: linear-gradient(135deg, #271a0c, #0f0b06); border: 1px solid #d97706; border-radius: 12px; padding: 24px; margin-bottom: 24px; color: #f8fafc; font-family: system-ui, -apple-system, sans-serif; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.15); position: relative;">
          <button class="close-breakdown-btn" style="position: absolute; top: 12px; right: 12px; background: transparent; border: none; color: #d97706; font-size: 16px; cursor: pointer; padding: 4px; border-radius: 4px;">✖</button>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; border-bottom: 1px solid #d97706; padding-bottom: 12px; padding-right: 20px;">
            <div style="display: flex; align-items: center;">
              <span style="font-size: 24px; margin-right: 12px;">🔫</span>
              <h3 style="margin: 0; font-size: 20px; font-weight: 700; color: #f59e0b; letter-spacing: 0.5px;">CS2 Premier Boosting</h3>
            </div>
            <div style="font-size: 22px; font-weight: 800; color: #fbbf24;">$${totalPrice.toFixed(2)}</div>
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; background: rgba(217, 119, 6, 0.1); padding: 12px; border-radius: 8px;">
            <div>
              <span style="font-size: 11px; text-transform: uppercase; color: #fbbf24; font-weight: 600;">Current Rating</span>
              <div style="font-size: 18px; font-weight: 700; color: #fff;">${currentRating}</div>
            </div>
            <div>
              <span style="font-size: 11px; text-transform: uppercase; color: #fbbf24; font-weight: 600;">Desired Rating</span>
              <div style="font-size: 18px; font-weight: 700; color: #fff;">${desiredRating}</div>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 20px;">
      `;
      
      breakdown.forEach(item => {
        html += `
          <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px; border-top: 4px solid #d97706; display: flex; flex-direction: column; align-items: center; justify-content: center;">
            <div style="font-size: 11px; color: #cbd5e1; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">${item.name}</div>
            <div style="font-size: 18px; font-weight: 800; color: #fff;">+${item.rating} <span style="font-size: 11px; color: #94a3b8; font-weight: 400;">pts</span></div>
            <div style="font-size: 11px; color: #fbbf24; margin-top: 4px; font-weight: 600;">$${item.cost.toFixed(2)} ($${item.rate}/k)</div>
          </div>
        `;
      });
      
      html += `
          </div>
          
          <div style="background: rgba(0,0,0,0.2); padding: 14px 20px; border-radius: 8px; font-weight: 700; display: flex; justify-content: space-between; align-items: center; border: 1px dashed #d97706; margin-bottom: 16px;">
            <span style="color: #fff;">Boost Difference: +${ratingDiff}</span>
            <span style="background: #d97706; color: white; padding: 4px 12px; border-radius: 20px; font-size: 14px;">Deadline: ${deadlineDays} Day${deadlineDays > 1 ? 's' : ''}</span>
          </div>

          <button class="auto-create-offer-btn" style="background-color: #d97706; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: 800; cursor: pointer; width: 100%; transition: all 0.2s ease; box-shadow: 0 4px 6px rgba(217, 119, 6, 0.2); text-transform: uppercase; font-size: 13px; letter-spacing: 1px;">
            ⚡ Auto-Create Offer — $${totalPrice.toFixed(2)} / ${deadlineDays} Day${deadlineDays > 1 ? 's' : ''}
          </button>
        </div>
      `;
      
      breakdownCard.innerHTML = html;
      
      // Remove any existing breakdowns
      document.querySelectorAll('.eldorado-r6-breakdown, .eldorado-cs2-breakdown').forEach(el => el.remove());
      
      // ALWAYS attach to document.body as a fixed overlay so React cannot destroy it
      // Use setAttribute so !important survives any later style mutations
      breakdownCard.setAttribute('data-eldorado-ui', 'true');
      breakdownCard.setAttribute('style',
        'position:fixed!important;top:20px!important;right:20px!important;' +
        'z-index:2147483647!important;width:420px!important;max-height:85vh!important;overflow-y:auto!important'
      );
      document.body.appendChild(breakdownCard);

      // Store so the guardian can re-inject it if React wipes it
      window.__eldoradoActiveBreakdownHtml = breakdownCard.outerHTML;
      window.__eldoradoActiveBreakdownClass = 'eldorado-cs2-breakdown';

      removeBadge(); // Done scanning
      
      const autoCreateBtn = breakdownCard.querySelector('.auto-create-offer-btn');
      if (autoCreateBtn) {
        autoCreateBtn.onmouseover = () => autoCreateBtn.style.backgroundColor = '#b45309';
        autoCreateBtn.onmouseout = () => autoCreateBtn.style.backgroundColor = '#d97706';
        autoCreateBtn.addEventListener('click', () => {
          autoFillAndCreateOffer(totalPrice, deadlineDays, (status) => {
            autoCreateBtn.textContent = `⚡ ${status}`;
          });
        });
      }
      
      const closeBtn = breakdownCard.querySelector('.close-breakdown-btn');
      if (closeBtn) {
        closeBtn.onmouseover = () => closeBtn.style.color = '#f87171';
        closeBtn.onmouseout = () => closeBtn.style.color = '#d97706';
        closeBtn.addEventListener('click', () => {
          window.__eldoradoBreakdownClosed = true;
          window.__eldoradoActiveBreakdownHtml = null;
          breakdownCard.remove();
        });
      }
      
      let finalPitch = template;
      if (finalPitch) {
        finalPitch = finalPitch.replace(/\[GAMES\]/g, `+${ratingDiff} Rating (${currentRating} to ${desiredRating})`);
        finalPitch = finalPitch.replace(/\[PRICE\]/g, totalPrice.toFixed(2));
      }
      
      if (finalPitch) {
        chrome.storage.local.set({
          eldorado_auto_pitch: finalPitch,
          calculate_cs2_rating: false
        }, () => {
          startChatFinder(finalPitch);
        });
      }
      return;
    }
    
    if (attempts > 60) { // 30 seconds
      clearInterval(cs2Interval);
      updateBadge('Could not find ratings.');
      console.log('[Eldorado Filter] CS2 tracker timed out - ratings not found.');
      setTimeout(removeBadge, 4000);
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

// Guardian: re-inject the breakdown card if React wipes it from the DOM
setInterval(() => {
  if (window.__eldoradoBreakdownClosed) return;
  if (!window.__eldoradoActiveBreakdownHtml || !window.__eldoradoActiveBreakdownClass) return;
  const existing = document.querySelector('.' + window.__eldoradoActiveBreakdownClass);
  if (!existing) {
    console.log('[Eldorado Filter] Guardian: breakdown card missing, re-injecting...');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = window.__eldoradoActiveBreakdownHtml;
    const newCard = wrapper.firstChild;
    if (newCard) {
      // Re-wire the close button
      const closeBtn = newCard.querySelector('.close-breakdown-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          window.__eldoradoBreakdownClosed = true;
          window.__eldoradoActiveBreakdownHtml = null;
          newCard.remove();
        });
      }
      // Re-wire Auto-Create button if present
      const autoCreateBtn = newCard.querySelector('.auto-create-offer-btn');
      if (autoCreateBtn) {
        autoCreateBtn.addEventListener('click', () => {
          // Button text contains the price; parse it out for re-use
          const match = (autoCreateBtn.textContent || '').match(/\$([\d.]+)/);
          const price = match ? parseFloat(match[1]) : 0;
          autoFillAndCreateOffer(price, 1, (status) => {
            autoCreateBtn.textContent = `⚡ ${status}`;
          });
        });
      }
      document.body.appendChild(newCard);
    }
  }
}, 250);

function checkAndRunBreakdown() {
  const isEldorado = location.hostname.includes('eldorado.gg');
  if (!isEldorado || window !== window.top) return;
  
  const pathname = location.pathname;
  // Broaden the page check to include chat/users page URL paths
  const isOrderOrChatPage = pathname.includes('/orders/') || 
                            pathname.includes('/order/') || 
                            pathname.includes('/chat/') || 
                            pathname.includes('/users/');
                            
  if (isOrderOrChatPage) {
    // Only start the tracker if it's not already running (tracked via global flag)
    if (!window.__eldoradoTrackerRunning) {
      chrome.storage.local.get(['eldorado_auto_pitch', 'calculate_r6_rp', 'calculate_cs2_rating'], (res) => {
        if (res.eldorado_auto_pitch) {
          if (res.calculate_r6_rp) {
            if (!window.__eldoradoTrackerRunning) {
              window.__eldoradoTrackerRunning = true;
              console.log("[Eldorado Filter] Starting R6 tracker from storage (DOM Mutation / page load)");
              startR6Tracker(res.eldorado_auto_pitch);
            }
          } else if (res.calculate_cs2_rating) {
            if (!window.__eldoradoTrackerRunning) {
              window.__eldoradoTrackerRunning = true;
              console.log("[Eldorado Filter] Starting CS2 tracker from storage (DOM Mutation / page load)");
              startCs2Tracker(res.eldorado_auto_pitch);
            }
          }
        } else {
          // View-only mode (direct access to order page without clicking Quick Pitch)
          if (!window.__eldoradoBreakdownClosed && !window.__eldoradoTrackerRunning) {
            const fullText = document.body.innerText || '';
            
            // Case-insensitive checks for R6S page keywords (check FIRST — more specific)
            const isR6Page = /Rainbow\s*Six|R6S|Ranked\s*Boosting|rp\s*gain|current\s*rank|desired\s*rank/i.test(fullText);
            
            // Case-insensitive checks for CS2 premier page keywords (only if not R6S)
            const isCs2Page = !isR6Page && (
                              cs2Regex.test(fullText) || 
                              /current\s*rating/i.test(fullText) || 
                              /desired\s*rating/i.test(fullText) || 
                              /enter\s*your\s*current/i.test(fullText)
                            );
            
            if (isR6Page) {
              window.__eldoradoTrackerRunning = true;
              console.log("[Eldorado Filter] Starting R6 tracker in View-Only mode");
              startR6Tracker(null);
            } else if (isCs2Page) {
              window.__eldoradoTrackerRunning = true;
              console.log("[Eldorado Filter] Starting CS2 tracker in View-Only mode");
              startCs2Tracker(null);
            }
          }
        }
      });
    }
  }
}

function throttledProcess() {
  if (throttleTimer) {
    pendingProcess = true;
    return;
  }
  
  processAllOrders();
  checkAndRunBreakdown();
  
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

  // Listen for debug messages from the main world
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'ELDORADO_MAIN_WORLD_LOG') {
      console.log('[Eldorado Filter] Main World:', event.data.message);
      const debugContainers = document.querySelectorAll('.eldorado-debug-logs');
      debugContainers.forEach(c => {
        c.style.display = 'block';
        c.innerHTML += `<div>• ${event.data.message}</div>`;
        c.scrollTop = c.scrollHeight;
      });
    }
  });

  if (isEldorado && window === window.top) {
    // Initial run for top window
    processAllOrders();
    checkAndRunBreakdown();
  } else {
    // Iframe or cross-origin chat (e.g. TalkJS on talkjs.com)
    chrome.storage.local.get(['eldorado_auto_pitch', 'calculate_r6_rp', 'calculate_cs2_rating'], (res) => {
      if (res.eldorado_auto_pitch) {
        if (!res.calculate_r6_rp && !res.calculate_cs2_rating) {
          // Pitch is already computed and stored
          startChatFinder(res.eldorado_auto_pitch);
        } else {
          // Wait for calculations to complete in top window
          const storageListener = (changes, area) => {
            if (area === 'local' && changes.eldorado_auto_pitch) {
              const calcR6 = changes.calculate_r6_rp ? changes.calculate_r6_rp.newValue : res.calculate_r6_rp;
              const calcCs2 = changes.calculate_cs2_rating ? changes.calculate_cs2_rating.newValue : res.calculate_cs2_rating;
              if (!calcR6 && !calcCs2) {
                startChatFinder(changes.eldorado_auto_pitch.newValue);
                chrome.storage.onChanged.removeListener(storageListener);
              }
            }
          };
          chrome.storage.onChanged.addListener(storageListener);
        }
      }
    });
  }

  if (isEldorado) {
    // Track URL changes using location.pathname instead of location.href to ignore query/anchor parameter changes
    let currentUrlPath = location.pathname;
    setInterval(() => {
      if (currentUrlPath !== location.pathname) {
        currentUrlPath = location.pathname;
        console.log(`[Eldorado Filter] SPA Navigation (Pathname change) detected: ${currentUrlPath}`);
        window.__eldoradoBreakdownClosed = false; // Reset close state on navigation
        window.__eldoradoTrackerRunning = false;  // Allow tracker to start fresh on new page
        window.__eldoradoActiveBreakdownHtml = null; // Clear cached card from previous page
        document.querySelectorAll('.eldorado-r6-breakdown, .eldorado-cs2-breakdown').forEach(el => el.remove());
        checkAndRunBreakdown();
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
