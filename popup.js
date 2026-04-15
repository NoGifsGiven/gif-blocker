const enabledCheckbox = document.getElementById("enabled");
const pwaOnlyCheckbox = document.getElementById("pwaOnly");
const domainInput = document.getElementById("domainInput");
const addDomainBtn = document.getElementById("addDomainBtn");
const domainListEl = document.getElementById("domainList");

const classInputSite = document.getElementById("classInputSite");
const addClassSiteBtn = document.getElementById("addClassSiteBtn");
const classListSiteEl = document.getElementById("classListSite");
const classInputGlobal = document.getElementById("classInputGlobal");
const addClassGlobalBtn = document.getElementById("addClassGlobalBtn");
const classListGlobalEl = document.getElementById("classListGlobal");
const cssSiteLabel = document.getElementById("cssSiteLabel");

const DEFAULT_DOMAINS = ["giphy.com", "cnn.com"];

// ── Current tab domain detection ──

let currentDomain = null;

function normalizeDomain(input) {
  let d = input.trim().toLowerCase();
  try {
    if (d.includes("://")) {
      d = new URL(d).hostname;
    }
  } catch {
    // not a URL, treat as raw domain
  }
  d = d.replace(/^www\./, "");
  d = d.split("/")[0];
  return d;
}

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]?.url) {
    currentDomain = normalizeDomain(tabs[0].url);
  }
  initUI();
});

function initUI() {
  if (currentDomain) {
    cssSiteLabel.textContent = "(" + currentDomain + ")";
    classInputSite.placeholder = "e.g. video-player";
  } else {
    cssSiteLabel.textContent = "(no site detected)";
    classInputSite.disabled = true;
    addClassSiteBtn.disabled = true;
  }

  chrome.storage.sync.get(
    { enabled: true, pwaOnly: true, blockedDomains: DEFAULT_DOMAINS, blockedClasses: {} },
    (settings) => {
      enabledCheckbox.checked = settings.enabled;
      pwaOnlyCheckbox.checked = settings.pwaOnly;
      renderDomainList(settings.blockedDomains);
      renderClassList(classListSiteEl, getSiteClasses(settings.blockedClasses), "site");
      renderClassList(classListGlobalEl, getGlobalClasses(settings.blockedClasses), "global");
    }
  );
}

// ── Tab switching ──

document.getElementById("cssTabBar").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (!btn) {
    return;
  }
  const tab = btn.dataset.tab;
  document.querySelectorAll("#cssTabBar button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  document.getElementById("tab-" + tab).classList.add("active");
});

// ── Domain list ──

function renderDomainList(domains) {
  domainListEl.innerHTML = "";
  if (domains.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-msg";
    empty.textContent = "No sites added yet.";
    domainListEl.appendChild(empty);
    return;
  }
  for (const domain of domains) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.className = "item-text";
    span.textContent = domain;
    const btn = document.createElement("button");
    btn.className = "remove-btn";
    btn.textContent = "\u00d7";
    btn.title = "Remove " + domain;
    btn.addEventListener("click", () => removeDomain(domain));
    li.appendChild(span);
    li.appendChild(btn);
    domainListEl.appendChild(li);
  }
}

function addDomain() {
  const domain = normalizeDomain(domainInput.value);
  if (!domain || !domain.includes(".")) {
    return;
  }

  chrome.storage.sync.get({ blockedDomains: DEFAULT_DOMAINS }, (settings) => {
    const domains = settings.blockedDomains;
    if (domains.includes(domain)) {
      domainInput.value = "";
      return;
    }
    domains.push(domain);
    chrome.storage.sync.set({ blockedDomains: domains }, () => {
      domainInput.value = "";
      renderDomainList(domains);
      notifyDomainsUpdated(domains);
    });
  });
}

function removeDomain(domain) {
  chrome.storage.sync.get({ blockedDomains: DEFAULT_DOMAINS }, (settings) => {
    const domains = settings.blockedDomains.filter((d) => d !== domain);
    chrome.storage.sync.set({ blockedDomains: domains }, () => {
      renderDomainList(domains);
      notifyDomainsUpdated(domains);
    });
  });
}

function notifyDomainsUpdated(domains) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        action: "domainsUpdated",
        blockedDomains: domains,
      }).catch(() => {});
    }
  });
}

// ── CSS class list ──
// Storage shape: blockedClasses: { "*": ["class1"], "cnn.com": ["class2", "class3"] }

function getSiteClasses(blockedClasses) {
  if (!currentDomain) {
    return [];
  }
  return blockedClasses[currentDomain] || [];
}

function getGlobalClasses(blockedClasses) {
  return blockedClasses["*"] || [];
}

function renderClassList(listEl, classes, scope) {
  listEl.innerHTML = "";
  if (classes.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-msg";
    empty.textContent = scope === "site" ? "No classes blocked on this site." : "No global classes blocked.";
    listEl.appendChild(empty);
    return;
  }
  for (const cls of classes) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.className = "item-text";
    span.textContent = "." + cls;
    const btn = document.createElement("button");
    btn.className = "remove-btn";
    btn.textContent = "\u00d7";
    btn.title = "Remove ." + cls;
    btn.addEventListener("click", () => removeClass(cls, scope));
    li.appendChild(span);
    li.appendChild(btn);
    listEl.appendChild(li);
  }
}

function normalizeClassName(input) {
  let c = input.trim();
  // Strip leading dot(s)
  c = c.replace(/^\.+/, "");
  return c;
}

function addClass(scope) {
  const input = scope === "site" ? classInputSite : classInputGlobal;
  const cls = normalizeClassName(input.value);
  if (!cls) {
    return;
  }

  const key = scope === "site" ? currentDomain : "*";
  if (!key) {
    return;
  }

  chrome.storage.sync.get({ blockedClasses: {} }, (settings) => {
    const all = settings.blockedClasses;
    const list = all[key] || [];
    if (list.includes(cls)) {
      input.value = "";
      return;
    }
    list.push(cls);
    all[key] = list;
    chrome.storage.sync.set({ blockedClasses: all }, () => {
      input.value = "";
      const listEl = scope === "site" ? classListSiteEl : classListGlobalEl;
      renderClassList(listEl, list, scope);
      notifyClassesUpdated(all);
    });
  });
}

function removeClass(cls, scope) {
  const key = scope === "site" ? currentDomain : "*";
  if (!key) {
    return;
  }

  chrome.storage.sync.get({ blockedClasses: {} }, (settings) => {
    const all = settings.blockedClasses;
    const list = (all[key] || []).filter((c) => c !== cls);
    if (list.length === 0) {
      delete all[key];
    } else {
      all[key] = list;
    }
    chrome.storage.sync.set({ blockedClasses: all }, () => {
      const listEl = scope === "site" ? classListSiteEl : classListGlobalEl;
      renderClassList(listEl, list, scope);
      notifyClassesUpdated(all);
    });
  });
}

function notifyClassesUpdated(blockedClasses) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        action: "classesUpdated",
        blockedClasses: blockedClasses,
      }).catch(() => {});
    }
  });
}

// ── Toggle enabled / pwaOnly ──

function saveAndNotify() {
  const enabled = enabledCheckbox.checked;
  const pwaOnly = pwaOnlyCheckbox.checked;

  chrome.storage.sync.get({ blockedDomains: DEFAULT_DOMAINS, blockedClasses: {} }, (settings) => {
    chrome.storage.sync.set({ enabled, pwaOnly }, () => {
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          chrome.tabs.sendMessage(tab.id, {
            action: "toggle",
            enabled,
            pwaOnly,
            blockedDomains: settings.blockedDomains,
            blockedClasses: settings.blockedClasses,
          }).catch(() => {});
        }
      });
    });
  });
}

// ── Event listeners ──

addDomainBtn.addEventListener("click", addDomain);
domainInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    addDomain();
  }
});
addClassSiteBtn.addEventListener("click", () => addClass("site"));
classInputSite.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    addClass("site");
  }
});
addClassGlobalBtn.addEventListener("click", () => addClass("global"));
classInputGlobal.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    addClass("global");
  }
});
enabledCheckbox.addEventListener("change", saveAndNotify);
pwaOnlyCheckbox.addEventListener("change", saveAndNotify);
