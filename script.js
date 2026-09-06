const DNS_URL = "https://raw.githubusercontent.com/ChrisTitusTech/winutil/refs/heads/main/config/dns.json";

let dnsData = {};
let selectedKey = null;

const dnsGrid = document.getElementById("dnsGrid");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");
const selectedNameEl = document.getElementById("selectedName");
const downloadBtn = document.getElementById("downloadBtn");
const dhcpBtn = document.getElementById("dhcpBtn");
const retryBtn = document.getElementById("retryBtn");

async function fetchDNS() {
  loadingEl.classList.remove("hidden");
  errorEl.classList.add("hidden");
  dnsGrid.innerHTML = "";

  try {
    const res = await fetch(DNS_URL);
    if (!res.ok) throw new Error();
    dnsData = await res.json();
    loadingEl.classList.add("hidden");
    renderCards(dnsData);
  } catch (err) {
    loadingEl.classList.add("hidden");
    errorEl.classList.remove("hidden");
    lucide.createIcons();
  }
}

function renderCards(data) {
  dnsGrid.innerHTML = "";
  const keys = Object.keys(data);

  keys.forEach(key => {
    const item = data[key];
    const card = document.createElement("div");
    card.className = `dns-card ${selectedKey === key ? "active" : ""}`;
    
    const v4 = [item.Primary, item.Secondary].filter(Boolean).join(" · ") || "N/A";
    const v6 = [item.Primary6, item.Secondary6].filter(Boolean).join(" · ") || "N/A";

    card.innerHTML = `
      <div class="card-header">
        <span class="card-title" title="${escapeHtml(key)}">${escapeHtml(key)}</span>
        <i data-lucide="${selectedKey === key ? 'check-circle-2' : 'circle'}" class="check-icon"></i>
      </div>
      <div class="ip-list">
        <div>IPv4: ${escapeHtml(v4)}</div>
        <div>IPv6: ${escapeHtml(v6)}</div>
      </div>
    `;

    card.addEventListener("click", () => selectProvider(key));
    dnsGrid.appendChild(card);
  });

  lucide.createIcons();
}

function selectProvider(key) {
  selectedKey = key;
  selectedNameEl.textContent = key;
  downloadBtn.disabled = false;
  renderCards(dnsData);
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
:: WinDNS Script - ${providerName}
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Please run this file as Administrator.
    pause
    exit /b
)
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
:: WinDNS Script - Restore DHCP
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Please run this file as Administrator.
    pause
    exit /b
)
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

downloadBtn.addEventListener("click", () => {
  if (!selectedKey || !dnsData[selectedKey]) return;
  const script = generateBatScript(selectedKey, dnsData[selectedKey]);
  downloadFile(`${selectedKey.replace(/[^a-zA-Z0-9_-]/g, '_')}_DNS.bat`, script);
});

dhcpBtn.addEventListener("click", () => {
  const script = generateDHCPBatScript();
  downloadFile("Restore_DHCP_DNS.bat", script);
});

retryBtn.addEventListener("click", fetchDNS);

fetchDNS();
