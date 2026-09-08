const DNS_URL = "https://raw.githubusercontent.com/ChrisTitusTech/winutil/refs/heads/main/config/dns.json";

const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
  (navigator.userAgentData && navigator.userAgentData.mobile) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));

if (isMobile) {
  document.getElementById("app")?.classList.add("hidden");
  document.getElementById("unsupportedDevice")?.classList.remove("hidden");
  lucide.createIcons();
} else {
  initPreview();
}

async function initPreview() {
  const detailFilename = document.getElementById("detailFilename");
  const detailCode = document.getElementById("detailCode");
  const copyCodeBtn = document.getElementById("copyCodeBtn");
  const copyBtnText = document.getElementById("copyBtnText");
  const downloadBtn = document.getElementById("downloadBtn");

  const params = new URLSearchParams(window.location.search);
  let key = params.get("key");

  if (!key) {
    const segments = window.location.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && !last.includes(".") && last.toLowerCase() !== "dns-changer") {
      key = decodeURIComponent(last);
    }
  }

  const isDhcp = key && (key.toLowerCase() === "dhcp" || key.toLowerCase() === "reset-dhcp");

  let currentFilename = "";
  let currentCode = "";
  let currentTitle = key ? (isDhcp ? "Reset DHCP" : key) : "";

  const cached = sessionStorage.getItem("preview_script");
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      // Ensure cached script matches current key
      if (parsed.filename && parsed.code) {
        if (!key || (isDhcp && parsed.title === "Reset DHCP") || (parsed.title === key)) {
          currentFilename = parsed.filename;
          currentCode = parsed.code;
          if (parsed.title) currentTitle = parsed.title;
        }
      }
    } catch (e) {}
  }

  if (!currentCode && key) {
    if (isDhcp) {
      currentFilename = "Restore_DHCP_DNS.bat";
      currentTitle = "Reset DHCP";
      currentCode = generateDHCPBatScript();
    } else {
      try {
        if (detailFilename) detailFilename.textContent = `Loading ${key}...`;
        const res = await fetch(DNS_URL);
        if (res.ok) {
          const data = await res.json();
          if (data[key]) {
            currentFilename = `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}_DNS.bat`;
            currentTitle = key;
            currentCode = generateBatScript(key, data[key]);
          }
        }
      } catch (err) {}
    }
  }

  if (!currentCode) {
    if (detailFilename) detailFilename.textContent = "No script selected";
    detailCode.textContent = "Please go back and select a DNS provider.";
    downloadBtn.disabled = true;
    copyCodeBtn.disabled = true;
    lucide.createIcons();
    return;
  }

  if (!currentTitle) {
    currentTitle = key ? (isDhcp ? "Reset DHCP" : key) : (currentFilename.replace(/_DNS\.bat$/i, "").replace(/_/g, " ") || "DNS Changer");
  }

  document.title = currentTitle;
  if (detailFilename) detailFilename.textContent = currentFilename;
  detailCode.textContent = currentCode;
  lucide.createIcons();

  // Clean URL to /Mullvad or /Reset-DHCP
  try {
    const basePath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
    const cleanSlug = isDhcp ? "Reset-DHCP" : encodeURIComponent(key);
    const cleanPath = basePath + cleanSlug;
    window.history.replaceState({ key }, currentTitle, cleanPath);
  } catch (e) {}

  copyCodeBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(currentCode);
    } catch (err) {
      const textarea = document.createElement("textarea");
      textarea.value = currentCode;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    copyCodeBtn.innerHTML = '<i data-lucide="check"></i>';
    lucide.createIcons();
    setTimeout(() => {
      copyCodeBtn.innerHTML = '<i data-lucide="copy"></i>';
      lucide.createIcons();
    }, 1500);
  });

  downloadBtn.addEventListener("click", () => {
    downloadFile(currentFilename, currentCode);
  });

  const dhcpBtn = document.getElementById("dhcpBtn");
  dhcpBtn?.addEventListener("click", () => {
    const script = generateDHCPBatScript();
    sessionStorage.setItem("preview_script", JSON.stringify({
      filename: "Restore_DHCP_DNS.bat",
      code: script,
      title: "Reset DHCP"
    }));
    window.location.href = "preview.html?key=Reset-DHCP";
  });
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
