const DNS_URL = "https://raw.githubusercontent.com/ChrisTitusTech/winutil/refs/heads/main/config/dns.json";

let dnsData = {};

const dnsList = document.getElementById("dnsList");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");
const dhcpBtn = document.getElementById("dhcpBtn");
const retryBtn = document.getElementById("retryBtn");

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
  } catch (err) {
    loadingEl.classList.add("hidden");
    errorEl.classList.remove("hidden");
  }
  lucide.createIcons();
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
      <button class="btn btn-primary download-item-btn" data-key="${escapeHtml(key)}">
        Download .BAT
      </button>
    `;

    row.querySelector(".download-item-btn").addEventListener("click", () => {
      const script = generateBatScript(key, item);
      downloadFile(`${key.replace(/[^a-zA-Z0-9_-]/g, '_')}_DNS.bat`, script);
    });

    dnsList.appendChild(row);
  });
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

dhcpBtn.addEventListener("click", () => {
  const script = generateDHCPBatScript();
  downloadFile("Restore_DHCP_DNS.bat", script);
});

retryBtn.addEventListener("click", fetchDNS);

fetchDNS();