const DNS_URL = "https://raw.githubusercontent.com/ChrisTitusTech/winutil/refs/heads/main/config/dns.json";

let dnsData = {};
let currentDetail = { filename: "", code: "", title: "" };

const listView = document.getElementById("listView");
const detailView = document.getElementById("detailView");
const dnsList = document.getElementById("dnsList");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");
const retryBtn = document.getElementById("retryBtn");
const dhcpBtn = document.getElementById("dhcpBtn");
const homeLink = document.getElementById("homeLink");
const detailCode = document.getElementById("detailCode");
const copyCodeBtn = document.getElementById("copyCodeBtn");
const downloadBtn = document.getElementById("downloadBtn");

async function fetchDNS() {
  loadingEl.classList.remove("hidden");
  errorEl.classList.add("hidden");
  dnsList.innerHTML = "";

  try {
    const res = await fetch(DNS_URL);
    if (!res.ok) throw new Error();
    dnsData = await res.json();
    loadingEl.classList.add("hidden");
    renderList(dnsData);
    handleRoute();
  } catch (err) {
    loadingEl.classList.add("hidden");
    errorEl.classList.remove("hidden");
  }
}

function getBasePath() {
  const isGitHubPages = window.location.hostname.endsWith("github.io");
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  if (isGitHubPages && pathParts.length > 0) {
    return `/${pathParts[0]}/`;
  }
  const repoIdx = window.location.pathname.indexOf("/DNS-Changer");
  if (repoIdx !== -1) {
    return window.location.pathname.substring(0, repoIdx + 12) + "/";
  }
  return "/";
}

function getCurrentRoute() {
  // Check if redirected from 404.html via ?r=...
  const params = new URLSearchParams(window.location.search);
  const redirectPath = params.get("r");
  if (redirectPath) {
    try {
      window.history.replaceState(null, "", redirectPath);
    } catch (e) {}
  }

  // Also support legacy hash if someone accesses #Mullvad
  if (window.location.hash) {
    const hashKey = window.location.hash.replace(/^#\/?/, "").trim();
    if (hashKey) {
      const basePath = getBasePath();
      try {
        window.history.replaceState(null, "", `${basePath}${encodeURIComponent(hashKey)}`);
      } catch (e) {}
      return decodeURIComponent(hashKey);
    }
  }

  const pathname = window.location.pathname;
  const basePath = getBasePath();
  
  let route = "";
  if (pathname.startsWith(basePath)) {
    route = pathname.slice(basePath.length);
  } else {
    route = pathname.replace(/^\//, "");
  }
  
  route = route.replace(/\/+$/, "").replace(/^index\.html/i, "").trim();
  return decodeURIComponent(route);
}

function navigateTo(routeKey) {
  const basePath = getBasePath();
  const newUrl = routeKey ? `${basePath}${encodeURIComponent(routeKey)}` : basePath;
  try {
    window.history.pushState(null, "", newUrl);
  } catch (e) {}
  handleRoute();
}

function renderList(data) {
  dnsList.innerHTML = "";
  const keys = Object.keys(data);

  keys.forEach(key => {
    const item = data[key];
    const row = document.createElement("div");
    row.className = "dns-item";
    
    const v4 = [item.Primary, item.Secondary].filter(Boolean).join(" · ") || "N/A";
    const v6 = [item.Primary6, item.Secondary6].filter(Boolean).join(" · ") || "N/A";

    row.innerHTML = `
      <div class="dns-info">
        <span class="dns-title">${escapeHtml(key)}</span>
        <div class="ip-list">IPv4: ${escapeHtml(v4)} | IPv6: ${escapeHtml(v6)}</div>
      </div>
    `;

    row.addEventListener("click", () => {
      navigateTo(key);
    });

    dnsList.appendChild(row);
  });
}

function showListView() {
  document.title = "DNS Changer";
  detailView.classList.add("hidden");
  listView.classList.remove("hidden");
}

function showDetailView(filename, code, title) {
  currentDetail = { filename, code, title };
  document.title = title;
  detailCode.textContent = code;
  resetCopyBtn();
  listView.classList.add("hidden");
  detailView.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "instant" });
  lucide.createIcons();
}

function handleRoute() {
  const route = getCurrentRoute();

  if (!route) {
    showListView();
    return;
  }

  if (route.toLowerCase() === "dhcp") {
    const script = generateDHCPBatScript();
    showDetailView("Restore_DHCP_DNS.bat", script, "Reset DHCP");
    return;
  }

  // If DNS data has loaded, search for key
  if (Object.keys(dnsData).length > 0) {
    const matchedKey = Object.keys(dnsData).find(
      k => k.toLowerCase() === route.toLowerCase()
    );

    if (matchedKey) {
      const item = dnsData[matchedKey];
      const script = generateBatScript(matchedKey, item);
      const filename = `${matchedKey.replace(/[^a-zA-Z0-9_-]/g, '_')}_DNS.bat`;
      showDetailView(filename, script, matchedKey);
      return;
    }

    // Key not found in loaded data
    showListView();
  }
}

function resetCopyBtn() {
  copyCodeBtn.innerHTML = '<i data-lucide="copy"></i>';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function generateBatScript(providerName, providerData) {
  const v4 = [providerData.Primary, providerData.Secondary].filter(Boolean);
  const v6 = [providerData.Primary6, providerData.Secondary6].filter(Boolean);
  const dohTemplate = providerData.DohTemplate || "";
  const dohOnly = providerData.DohOnly || false;

  let psScript = `$adapters = Get-NetAdapter | Where-Object {$_.Status -eq 'Up'}; ` +
    `if (-not $adapters) { Write-Host 'No active network adapters found.' -ForegroundColor Red; exit }; ` +
    `foreach ($a in $adapters) { ` +
    `Write-Host 'Configuring adapter:' $a.Name; `;

  if (v4.length) {
    const ips = v4.map(ip => `'${ip}'`).join(',');
    psScript += `Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ServerAddresses (${ips}); `;
  }
  if (v6.length) {
    const ips = v6.map(ip => `'${ip}'`).join(',');
    psScript += `Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ServerAddresses (${ips}); `;
  }

  if (dohTemplate) {
    v4.concat(v6).forEach(ip => {
      const mode = dohOnly ? "DohOnly" : "DohWithFallback";
      psScript += `try { Add-DnsClientDohServerAddress -ServerAddress '${ip}' -DohTemplate '${dohTemplate}' -AllowDohAutoUpgrade $true -ErrorAction SilentlyContinue; Set-DnsClientDohServerAddress -ServerAddress '${ip}' -AutoUpgradeState ${mode} -ErrorAction SilentlyContinue } catch {}; `;
    });
  }

  psScript += `}; Write-Host 'Flushing DNS cache...'; ipconfig /flushdns > $null; Write-Host 'DNS configured successfully.' -ForegroundColor Green;`;

  return `@echo off
:: Self-elevate script to Administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

:: DNS Changer - ${providerName}
powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"
pause
`;
}

function generateDHCPBatScript() {
  const psScript = `$adapters = Get-NetAdapter | Where-Object {$_.Status -eq 'Up'}; ` +
    `if (-not $adapters) { Write-Host 'No active network adapters found.' -ForegroundColor Red; exit }; ` +
    `foreach ($a in $adapters) { ` +
    `Write-Host 'Resetting adapter:' $a.Name; ` +
    `Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ResetServerAddresses; ` +
    `}; Write-Host 'Flushing DNS cache...'; ipconfig /flushdns > $null; Write-Host 'DHCP restored successfully.' -ForegroundColor Green;`;

  return `@echo off
:: Self-elevate script to Administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

:: DNS Changer - Restore DHCP
powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"
pause
`;
}

function downloadFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
  (navigator.userAgentData && navigator.userAgentData.mobile) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));

if (isMobile) {
  document.getElementById("app")?.classList.add("hidden");
  document.getElementById("unsupportedDevice")?.classList.remove("hidden");
  lucide.createIcons();
} else {
  // Navigation events
  window.addEventListener("popstate", handleRoute);
  window.addEventListener("hashchange", handleRoute);

  homeLink?.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo("");
  });

  dhcpBtn?.addEventListener("click", () => {
    navigateTo("dhcp");
  });

  retryBtn?.addEventListener("click", fetchDNS);

  // Detail actions
  copyCodeBtn?.addEventListener("click", async () => {
    if (!currentDetail.code) return;
    try {
      await navigator.clipboard.writeText(currentDetail.code);
      copyCodeBtn.innerHTML = '<i data-lucide="check"></i>';
      lucide.createIcons();
      setTimeout(() => {
        resetCopyBtn();
        lucide.createIcons();
      }, 1500);
    } catch {
      // Fallback if clipboard API is restricted
      const textarea = document.createElement("textarea");
      textarea.value = currentDetail.code;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      copyCodeBtn.innerHTML = '<i data-lucide="check"></i>';
      lucide.createIcons();
      setTimeout(() => {
        resetCopyBtn();
        lucide.createIcons();
      }, 1500);
    }
  });

  downloadBtn?.addEventListener("click", () => {
    if (!currentDetail.code || !currentDetail.filename) return;
    downloadFile(currentDetail.filename, currentDetail.code);
  });

  lucide.createIcons();
  fetchDNS();
}