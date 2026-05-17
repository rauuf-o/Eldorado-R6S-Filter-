const defaultSettings = {
  showPC: true,
  showPS: false,
  showXbox: false,
  enableSounds: true,
  pitchTemplate: "Hey! 👋 Thank you for choosing us! 🏆\n\nI've just reviewed your order details, and I can start your boost immediately! Here is your custom package:\n\n🎮 Total Games: [GAMES] Wins\n💰 Special Price: $[PRICE]\n\n🔥 Why Choose Us?\n✅ Top 500 Champion Boosters\n✅ 90%+ Win Rate (Fast & Safe)\n✅ Safe Play: Premium VPN + Offline Mode\n✅ Real-time progress updates in chat!\n\nWe are ready to start right now. If everything looks good, please confirm the order and we will jump on instantly! 🚀 Let us know if you have any questions! Let's get those wins! 💪",
  priceBase: 1.0,
  pricePlat: 1.5,
  priceEme: 2.0,
  priceDia: 3.0,
  priceChamp: 4.0
};

// Map checkboxes to their elements
const checkboxes = {
  showPC: document.getElementById('showPC'),
  showPS: document.getElementById('showPS'),
  showXbox: document.getElementById('showXbox'),
  enableSounds: document.getElementById('enableSounds')
};

const pitchTextarea = document.getElementById('pitchTemplate');
const saveBtn = document.getElementById('saveBtn');
const priceInputs = {
  priceBase: document.getElementById('priceBase'),
  pricePlat: document.getElementById('pricePlat'),
  priceEme: document.getElementById('priceEme'),
  priceDia: document.getElementById('priceDia'),
  priceChamp: document.getElementById('priceChamp')
};

// Load the settings from Chrome's synchronized storage and populate the inputs
chrome.storage.sync.get(defaultSettings, (settings) => {
  for (const key in checkboxes) {
    checkboxes[key].checked = settings[key];
  }
  for (const key in priceInputs) {
    if (priceInputs[key]) priceInputs[key].value = settings[key];
  }
  pitchTextarea.value = settings.pitchTemplate;
});

// Function to read all inputs and save them into storage
function saveSettings() {
  const newSettings = {};
  for (const key in checkboxes) {
    newSettings[key] = checkboxes[key].checked;
  }
  for (const key in priceInputs) {
    if (priceInputs[key]) newSettings[key] = parseFloat(priceInputs[key].value) || defaultSettings[key];
  }
  newSettings.pitchTemplate = pitchTextarea.value;
  
  chrome.storage.sync.set(newSettings, () => {
    saveBtn.textContent = 'Saved!';
    saveBtn.style.backgroundColor = '#2b7a4b';
    setTimeout(() => {
      saveBtn.textContent = 'Save Settings';
      saveBtn.style.backgroundColor = '#38a169';
    }, 1500);
  });
}

// Add 'click' event listener to the save button
saveBtn.addEventListener('click', saveSettings);
