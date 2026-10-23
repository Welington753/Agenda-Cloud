<#
Abre uma fase da publicacao de AccountsAdministration no piloto num terminal
interativo. Mesmo formato do lancador da promocao MASTER_OWNER (por -File,
sem montar comandos com aspas; Endpoint IDs como parametros, nunca exibidos).
A URL direta e pedida oculta pelo proprio script. Ver
docs/runbooks/publicacao-contas-piloto.md.

Fases:
  preparar     so leitura no piloto: destino, TLS, before e backup
  restauracao  sem conexao com o piloto: restaura o backup num PostgreSQL
               descartavel local, confere e ensaia a migration na copia
  aplicar      backup novo, frase de confirmacao, so a migration pendente, after
  conferir     so leitura no piloto: -Esperado before ou after

Uso, no Windows Terminal (no console classico Ctrl+V nao cola em modo oculto):
  wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass `
    -File <clone>\backend\scripts\abrir-contas-piloto.ps1 -Fase preparar `
    -PilotEndpointId <ep-...> -ProductionEndpointId <ep-...>
#>
param(
  [Parameter(Mandatory)] [ValidateSet('preparar', 'restauracao', 'aplicar', 'conferir')] [string] $Fase,
  [ValidateSet('before', 'after')] [string] $Esperado = 'after',
  [string] $PilotEndpointId = '',
  [string] $ProductionEndpointId = '',
  [string] $Pasta = '',
  [string] $PgBin = 'C:\Program Files\PostgreSQL\18\bin',
  [string] $OpsDir = (Join-Path $env:USERPROFILE 'AgendaCloud-operacoes')
)

$precisaDoPiloto = $Fase -ne 'restauracao'
# Conferido aqui (e de novo no script) sem repetir o valor na mensagem.
$formato = '^ep-[a-z0-9]+(-[a-z0-9]+)*$'
if ($precisaDoPiloto -and ($PilotEndpointId -cnotmatch $formato -or $ProductionEndpointId -cnotmatch $formato)) {
  Write-Host 'ERRO: Endpoint ID ausente ou fora do formato ep-...; nada foi executado.'
  return
}

$Host.UI.RawUI.WindowTitle = "Agenda-Cloud - contas no piloto - $Fase"
$backend = Split-Path -Parent $PSScriptRoot
Set-Location $backend

$env:IGNORE_DOTENV_FILE = 'true'
$env:PG_BIN = $PgBin
$env:AGENDA_OPS_DIR = $OpsDir
Remove-Item Env:NODE_EXTRA_CA_CERTS, Env:DATABASE_URL, Env:DIRECT_URL -ErrorAction SilentlyContinue
if ($precisaDoPiloto) {
  $env:PILOT_ENDPOINT_ID = $PilotEndpointId
  $env:PRODUCTION_ENDPOINT_ID = $ProductionEndpointId
}

$commit = git rev-parse --short HEAD
$pgDump = Join-Path $PgBin 'pg_dump.exe'
$versaoPgDump = if (Test-Path -LiteralPath $pgDump) { & $pgDump --version } else { 'AUSENTE' }
$console = if ($env:WT_SESSION) { 'Windows Terminal' } else { 'console classico (Ctrl+V nao cola; use o botao direito)' }

Write-Host "Fase: $Fase"
Write-Host "Commit: $commit"
Write-Host "Pasta: $backend"
Write-Host "pg_dump: $versaoPgDump"
Write-Host "Operacoes: $OpsDir"
if ($precisaDoPiloto) { Write-Host 'Endpoint IDs: definidos (nao exibidos)' }
Write-Host "Console: $console"
Write-Host ''
Write-Host 'Compilando migrations e conferencias (sem rede)...'
npm run --silent build:migrations-runtime
$okMigrations = $LASTEXITCODE -eq 0
npm run --silent build:guarded-migration-scripts
$okScripts = $LASTEXITCODE -eq 0
if (-not ($okMigrations -and $okScripts)) {
  Write-Host 'ERRO: build falhou; nada foi executado.'
  Remove-Item Env:PILOT_ENDPOINT_ID, Env:PRODUCTION_ENDPOINT_ID -ErrorAction SilentlyContinue
  return
}
Write-Host ''
if ($precisaDoPiloto) {
  Write-Host 'Cole a URL direta uma unica vez (nada aparece na tela) e pressione Enter uma vez.'
  Write-Host ''
}

try {
  if ($Fase -eq 'restauracao') {
    if ($Pasta) { node scripts/conferir-restauracao-piloto.mjs "--pasta=$Pasta" } else { node scripts/conferir-restauracao-piloto.mjs }
  } else {
    node scripts/aplicar-contas-piloto.mjs "--fase=$Fase" "--esperado=$Esperado"
  }
  $codigo = $LASTEXITCODE
} finally {
  Remove-Item Env:PILOT_ENDPOINT_ID, Env:PRODUCTION_ENDPOINT_ID -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host "Script terminou com codigo $codigo. A janela continua aberta."
