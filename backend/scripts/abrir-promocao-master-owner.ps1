<#
Abre o procedimento de promoção MASTER_OWNER (promover-master-owner.mjs) num
terminal interativo. Não contém nem imprime Endpoint IDs, URL ou senha; a URL é
pedida oculta pelo próprio script. Ver
docs/runbooks/continuidade-promocao-master-owner.md.

Uso, no Windows Terminal (no console clássico Ctrl+V não cola em modo oculto):
  wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass `
    -File <clone>\backend\scripts\abrir-promocao-master-owner.ps1 `
    -PilotEndpointId <ep-...> -ProductionEndpointId <ep-...>
#>
param(
  [Parameter(Mandatory)] [string] $PilotEndpointId,
  [Parameter(Mandatory)] [string] $ProductionEndpointId,
  [string] $PgBin = 'C:\Program Files\PostgreSQL\18\bin',
  [string] $OpsDir = (Join-Path $env:USERPROFILE 'AgendaCloud-operacoes')
)

# Conferido aqui (e de novo no script) sem repetir o valor na mensagem.
$formato = '^ep-[a-z0-9]+(-[a-z0-9]+)*$'
if ($PilotEndpointId -cnotmatch $formato -or $ProductionEndpointId -cnotmatch $formato) {
  Write-Host 'ERRO: Endpoint ID fora do formato ep-...; nada foi executado.'
  return
}

$Host.UI.RawUI.WindowTitle = 'Agenda-Cloud - promocao MASTER_OWNER (piloto)'
$backend = Split-Path -Parent $PSScriptRoot
Set-Location $backend

$env:IGNORE_DOTENV_FILE = 'true'
$env:PILOT_ENDPOINT_ID = $PilotEndpointId
$env:PRODUCTION_ENDPOINT_ID = $ProductionEndpointId
$env:PG_BIN = $PgBin
$env:AGENDA_OPS_DIR = $OpsDir
Remove-Item Env:NODE_EXTRA_CA_CERTS -ErrorAction SilentlyContinue

$commit = git rev-parse --short HEAD
$pgDump = Join-Path $PgBin 'pg_dump.exe'
$versaoPgDump = if (Test-Path -LiteralPath $pgDump) { & $pgDump --version } else { 'AUSENTE' }
$console = if ($env:WT_SESSION) { 'Windows Terminal' } else { 'console classico (Ctrl+V nao cola; use o botao direito)' }

Write-Host "Commit: $commit"
Write-Host "Pasta: $backend"
Write-Host "pg_dump: $versaoPgDump"
Write-Host "Operacoes: $OpsDir"
Write-Host 'Endpoint IDs: definidos (nao exibidos)'
Write-Host "Console: $console"
Write-Host ''
Write-Host 'Cole a URL direta uma unica vez (nada aparece na tela) e pressione Enter uma vez.'
Write-Host 'Confira TLS_CLIENTE, PAPEL_ATUAL e BACKUP_OK antes de digitar a confirmacao.'
Write-Host ''

try {
  node scripts/promover-master-owner.mjs
  $codigo = $LASTEXITCODE
} finally {
  Remove-Item Env:PILOT_ENDPOINT_ID, Env:PRODUCTION_ENDPOINT_ID -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host "Script terminou com codigo $codigo. A janela continua aberta."
