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
    checkUrlParams();
  } catch (err) {
    loadingEl.classList.add("hidden");
    errorEl.classList.remove("hidden");
  }
}

function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const dnsParam = params.get("dns");
  const isDhcp = params.has("dhcp") || (dnsParam && dnsParam.toLowerCase() === "dhcp");

  if (isDhcp) {
    const script = generateDHCPBatScript();
    showDetailView("Restore_DHCP_DNS.bat", script, "Reset DHCP");
    return;
  }

  if (dnsParam && Object.keys(dnsData).length > 0) {
    const matchedKey = Object.keys(dnsData).find(
      k => k.toLowerCase() === dnsParam.toLowerCase()
    );
    if (matchedKey) {
      const item = dnsData[matchedKey];
      const script = generateBatScript(matchedKey, item);
      const filename = `${matchedKey.replace(/[^a-zA-Z0-9_-]/g, '_')}_DNS.bat`;
      showDetailView(filename, script, matchedKey);
      return;
    }
  }

  showListView();
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
      const script = generateBatScript(key, item);
      const filename = `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}_DNS.bat`;
      showDetailView(filename, script, key);
      try {
        const url = new URL(window.location);
        url.search = `?dns=${encodeURIComponent(key)}`;
        window.history.pushState(null, "", url);
      } catch (e) {}
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
  const allIps = v4.concat(v6);
  const dohTemplate = providerData.DohTemplate || "";
  const secDohTemplate = providerData.SecondaryDohTemplate || "";
  const dohOnly = Boolean(providerData.DohOnly);
  const secIps = [providerData.Secondary, providerData.Secondary6].filter(Boolean);

  let commands = [];
  commands.push(`$adapters = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' }`);
  commands.push(`if (-not $adapters) { Write-Host 'No active network adapters found.' -ForegroundColor Red; exit }`);

  commands.push(`$dohSupported = [bool](Get-Command Add-DnsClientDohServerAddress -ErrorAction SilentlyContinue)`);
  if (dohOnly) {
    commands.push(`if (-not $dohSupported) { Write-Warning 'DNS provider ${providerName} requires DNS over HTTPS (DoH), which is not supported on this Windows version.'; exit }`);
  }

  // 1. One-shot DoH query into RAM: 0ms in-memory lookup instead of 1000ms WMI calls
  if (dohTemplate) {
    let dohSetup = `if ($dohSupported) { ` +
      `$existingDoh = @(Get-DnsClientDohServerAddress -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ServerAddress); `;
    allIps.forEach(ip => {
      const template = (secDohTemplate && secIps.includes(ip)) ? secDohTemplate : dohTemplate;
      const fallback = dohOnly ? '$false' : '$true';
      dohSetup += `if ($existingDoh -contains '${ip}') { ` +
        `Set-DnsClientDohServerAddress -ServerAddress '${ip}' -DohTemplate '${template}' -AllowFallbackToUdp ${fallback} -AutoUpgrade $true -ErrorAction SilentlyContinue; ` +
        `} else { ` +
        `Write-Host 'Registering DoH: ${ip}...'; ` +
        `Add-DnsClientDohServerAddress -ServerAddress '${ip}' -DohTemplate '${template}' -AllowFallbackToUdp ${fallback} -AutoUpgrade $true -ErrorAction SilentlyContinue; ` +
        `}; `;
    });
    dohSetup += `}`;
    commands.push(dohSetup);
  }

  // 2. Set all IPv4 and IPv6 together in 1 command, and use fast native reg.exe (<5ms)
  const ipsFormatted = allIps.map(ip => `'${ip}'`).join(',');
  let adapterLoop = `foreach ($a in $adapters) { ` +
    `Write-Host ('Configuring adapter: ' + $a.Name) -ForegroundColor Cyan; ` +
    `Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ServerAddresses @(${ipsFormatted}) -ErrorAction Stop; `;

  if (dohTemplate) {
    adapterLoop += `if ($dohSupported) { `;
    allIps.forEach(ip => {
      const leaf = ip.includes(':') ? 'Doh6' : 'Doh';
      adapterLoop += `reg.exe add ('HKLM\\System\\CurrentControlSet\\Services\\Dnscache\\InterfaceSpecificParameters\\' + $a.InterfaceGuid + '\\DohInterfaceSettings\\${leaf}\\${ip}') /v DohFlags /t REG_QWORD /d 1 /f | Out-Null; `;
    });
    adapterLoop += `}; `;
  }

  adapterLoop += `}`;
  commands.push(adapterLoop);

  // 3. Native Win32 DNS flush (30ms)
  commands.push(`Write-Host 'Flushing DNS cache...'; ipconfig /flushdns | Out-Null; Write-Host 'DNS configured successfully: ${providerName}' -ForegroundColor Green`);

  const psScript = commands.join('; ');

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
  const psScript = [
    `$adapters = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' }`,
    `if (-not $adapters) { Write-Host 'No active network adapters found.' -ForegroundColor Red; exit }`,
    `foreach ($a in $adapters) { ` +
      `Write-Host ('Resetting adapter: ' + $a.Name) -ForegroundColor Cyan; ` +
      `Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ResetServerAddresses; ` +
      `reg.exe delete ('HKLM\\System\\CurrentControlSet\\Services\\Dnscache\\InterfaceSpecificParameters\\' + $a.InterfaceGuid + '\\DohInterfaceSettings') /f 2>$null | Out-Null; ` +
    `}`,
    `Write-Host 'Flushing DNS cache...'`,
    `ipconfig /flushdns | Out-Null`,
    `Write-Host 'DHCP restored successfully.' -ForegroundColor Green`
  ].join('; ');

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
  window.addEventListener("popstate", () => {
    checkUrlParams();
  });

  homeLink?.addEventListener("click", (e) => {
    e.preventDefault();
    showListView();
    try {
      const url = new URL(window.location);
      url.search = "";
      window.history.pushState(null, "", url);
    } catch (e) {}
  });

  dhcpBtn?.addEventListener("click", () => {
    const script = generateDHCPBatScript();
    showDetailView("Restore_DHCP_DNS.bat", script, "Reset DHCP");
    try {
      const url = new URL(window.location);
      url.search = "?dhcp";
      window.history.pushState(null, "", url);
    } catch (e) {}
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