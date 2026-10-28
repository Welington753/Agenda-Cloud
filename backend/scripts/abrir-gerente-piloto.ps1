<#
Abre uma fase da publicacao de TeamManagerAccess1793145600000 num terminal
interativo. Mesmo formato do lancador de TeamAccess (abrir-equipe-piloto.ps1): por
-File, sem montar comandos com aspas, Endpoint IDs como parametros e nunca
exibidos. A URL direta e pedida oculta pelo proprio script. Ver
docs/runbooks/publicacao-gerente-piloto.md.

Fases:
  preparar     so leitura no destino: TLS, before-team-manager, vagas e colisoes
               de login, backup
  restauracao  sem conexao com o destino: restaura o backup num PostgreSQL
               descartavel local, confere e ensaia TeamManagerAccess na copia
  aplicar      backup novo, frase de confirmacao, so TeamManagerAccess, after
  conferir     so leitura no destino: identifica o estado atual

Modos:
  (padrao)     PILOTO: Neon real; recusa qualquer ajuste de ensaio
  -Ensaio      ENSAIO: PostgreSQL descartavel local que imita o piloto
               (Endpoint IDs ep-ensaio-..., -EnsaioCa com a CA descartavel);
               pasta de operacoes separada por padrao

Uso, no Windows Terminal (no console classico Ctrl+V nao cola em modo oculto):
  wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass `
    -File <clone>\backend\scripts\abrir-gerente-piloto.ps1 -Fase preparar `
    -PilotEndpointId <ep-...> -ProductionEndpointId <ep-...>
#>
param(
  [Parameter(Mandatory)] [ValidateSet('preparar', 'restauracao', 'aplicar', 'conferir')] [string] $Fase,
  [string] $PilotEndpointId = '',
  [string] $ProductionEndpointId = '',
  [string] $Pasta = '',
  [string] $PgBin = 'C:\Program Files\PostgreSQL\18\bin',
  [string] $OpsDir = '',
  [switch] $Ensaio,
  [string] $EnsaioCa = '',
  [string] $EnsaioEndereco = '127.0.0.1'
)

$modo = if ($Ensaio) { 'ensaio' } else { 'piloto' }
$rotuloModo = if ($Ensaio) { 'ENSAIO (PostgreSQL descartavel local; nada e feito no piloto)' } else { 'PILOTO (Neon real)' }
if (-not $OpsDir) {
  $OpsDir = if ($Ensaio) { Join-Path $env:USERPROFILE 'AgendaCloud-operacoes-ensaio' } else { Join-Path $env:USERPROFILE 'AgendaCloud-operacoes' }
}

$precisaDoDestino = $Fase -ne 'restauracao'
# Conferido aqui (e de novo no script) sem repetir o valor na mensagem.
$formato = '^ep-[a-z0-9]+(-[a-z0-9]+)*$'
if ($precisaDoDestino -and ($PilotEndpointId -cnotmatch $formato -or $ProductionEndpointId -cnotmatch $formato)) {
  Write-Host 'ERRO: Endpoint ID ausente ou fora do formato ep-...; nada foi executado.'
  return
}
if ($Ensaio -and $precisaDoDestino -and (-not $EnsaioCa -or -not (Test-Path -LiteralPath $EnsaioCa -PathType Leaf))) {
  Write-Host 'ERRO: -Ensaio exige -EnsaioCa com o arquivo da CA descartavel; nada foi executado.'
  return
}

$Host.UI.RawUI.WindowTitle = "Agenda-Cloud - TeamManagerAccess - $($modo.ToUpper()) - $Fase"
$backend = Split-Path -Parent $PSScriptRoot
Set-Location $backend

# Ambiente limpo: nada de .env, URL, CA extra ou opcao do Node herdados.
$env:IGNORE_DOTENV_FILE = 'true'
$env:PG_BIN = $PgBin
$env:AGENDA_OPS_DIR = $OpsDir
$env:AGENDA_OPS_MODO = $modo
Remove-Item Env:NODE_EXTRA_CA_CERTS, Env:NODE_OPTIONS, Env:NODE_USE_SYSTEM_CA, Env:NODE_TLS_REJECT_UNAUTHORIZED, Env:DATABASE_URL, Env:DIRECT_URL, Env:AGENDA_ENSAIO_CA, Env:AGENDA_ENSAIO_ENDERECO -ErrorAction SilentlyContinue
if ($precisaDoDestino) {
  $env:PILOT_ENDPOINT_ID = $PilotEndpointId
  $env:PRODUCTION_ENDPOINT_ID = $ProductionEndpointId
  if ($Ensaio) {
    $env:AGENDA_ENSAIO_CA = (Resolve-Path -LiteralPath $EnsaioCa).Path
    $env:AGENDA_ENSAIO_ENDERECO = $EnsaioEndereco
  }
}

$commit = git rev-parse HEAD
$pgDump = Join-Path $PgBin 'pg_dump.exe'
$versaoPgDump = if (Test-Path -LiteralPath $pgDump) { & $pgDump --version } else { 'AUSENTE' }
$console = if ($env:WT_SESSION) { 'Windows Terminal' } else { 'console classico (Ctrl+V nao cola; use o botao direito)' }

Write-Host "Modo: $rotuloModo"
Write-Host "Fase: $Fase"
Write-Host "Commit: $commit"
Write-Host "Pasta: $backend"
Write-Host "Operacoes: $OpsDir"
Write-Host "pg_dump: $versaoPgDump"
if ($precisaDoDestino) { Write-Host 'Endpoint IDs: definidos (nao exibidos)' }
Write-Host "Console: $console"
Write-Host ''
Write-Host 'Compilando migrations e conferencias (sem rede)...'
npm run --silent build:migrations-runtime
$okMigrations = $LASTEXITCODE -eq 0
npm run --silent build:guarded-migration-scripts
$okScripts = $LASTEXITCODE -eq 0
$codigo = 1
try {
  if (-not ($okMigrations -and $okScripts)) {
    Write-Host 'ERRO: build falhou; nada foi executado.'
    return
  }
  Write-Host ''
  if ($precisaDoDestino) {
    Write-Host 'Cole a URL direta uma unica vez (nada aparece na tela) e pressione Enter uma vez.'
    Write-Host ''
  }
  if ($Fase -eq 'restauracao') {
    if ($Pasta) { node scripts/conferir-restauracao-gerente.mjs "--pasta=$Pasta" } else { node scripts/conferir-restauracao-gerente.mjs }
  } else {
    node scripts/aplicar-gerente-piloto.mjs "--fase=$Fase"
  }
  $codigo = $LASTEXITCODE
} finally {
  Remove-Item Env:PILOT_ENDPOINT_ID, Env:PRODUCTION_ENDPOINT_ID, Env:AGENDA_ENSAIO_CA, Env:AGENDA_ENSAIO_ENDERECO, Env:AGENDA_OPS_MODO -ErrorAction SilentlyContinue
  Write-Host ''
  Write-Host "Script terminou com codigo $codigo. A janela continua aberta. Modo: $($modo.ToUpper())."
}
