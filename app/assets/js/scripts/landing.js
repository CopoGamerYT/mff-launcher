/**
 * Script for landing.ejs
 */
// Requirements
const { URL }                   = require('url')
const {
    MojangRestAPI,
    getServerStatus
}                               = require('helios-core/mojang')
const {
    RestResponseStatus,
    isDisplayableError,
    validateLocalFile
}                               = require('helios-core/common')
const {
    FullRepair,
    DistributionIndexProcessor,
    MojangIndexProcessor,
    downloadFile
}                               = require('helios-core/dl')

// MODIFICADO: Hacemos que las funciones de Java sean globales para que settings.js las vea
const javaCore = require('helios-core/java')
window.validateSelectedJvm = javaCore.validateSelectedJvm
window.ensureJavaDirIsRoot = javaCore.ensureJavaDirIsRoot
window.javaExecFromRoot = javaCore.javaExecFromRoot
window.discoverBestJvmInstallation = javaCore.discoverBestJvmInstallation
window.latestOpenJDK = javaCore.latestOpenJDK
window.extractJdk = javaCore.extractJdk


// Internal Requirements
const DiscordWrapper            = require('./assets/js/discordwrapper')
const ProcessBuilder            = require('./assets/js/processbuilder')

// Launch Elements
let launch_content, launch_details, launch_progress, launch_progress_label, launch_details_text;

// --- XEONY FIX: Variable de Estado Global para evitar bugs visuales ---
let isGameRunning = false; 

const loggerLanding = LoggerUtil.getLogger('Landing')

// ==================================================================================
// --- MODIFICADO: FUNCIONES TEXTO DE CARGA ---
// ==================================================================================
let loadingMsgIndex = 0;
let loadingMsgInterval;
const loadingMessages = [
    "Cargando Recursos...",
    "Obteniendo Recursos...",
    "Cargando Launcher..."
];

function startLoadingTextCycle() {
    const textEl = document.getElementById('loading-text');
    if(!textEl) return;

    textEl.innerText = loadingMessages[0];
    textEl.classList.add('text-visible');

    loadingMsgInterval = setInterval(() => {
        textEl.classList.remove('text-visible'); 
        setTimeout(() => {
            loadingMsgIndex = (loadingMsgIndex + 1) % loadingMessages.length;
            textEl.innerText = loadingMessages[loadingMsgIndex];
            textEl.classList.add('text-visible'); 
        }, 500);
    }, 2500);
}

function finishLoadingText() {
    clearInterval(loadingMsgInterval);
    const textEl = document.getElementById('loading-text');
    if(textEl) {
        textEl.classList.remove('text-visible');
        setTimeout(() => {
            textEl.innerText = "Listo, diviértete";
            textEl.style.color = "#ffffff"; 
            textEl.classList.add('text-visible');
        }, 500);
    }
}

// ==================================================================================
// --- XEONYS BACKGROUNDS HÍBRIDOS (IMG + MP4) ---
// ==================================================================================
const REMOTE_BG_URL = "http://va1.holy.gg:26403/launcherfiles/backgrounds/"; 
const DEFAULT_BG_LOCAL = "../images/backgrounds/loading/0.jpg"; 
const ALLOWED_EXTENSIONS = [".mp4", ".gif", ".png", ".jpg", ".jpeg"];

function changeServerBackground(serverId) {
    const container = document.getElementById('landingContainer');
    if (!container) return;

    let videoEl = document.getElementById('bgVideo');
    if (!videoEl) {
        videoEl = document.createElement('video');
        videoEl.id = 'bgVideo';
        videoEl.autoplay = true;
        videoEl.loop = true;
        videoEl.muted = true; 
        container.insertBefore(videoEl, container.firstChild);
    }

    const applyBackground = (url, isVideo) => {
        if (isVideo) {
            videoEl.src = url;
            videoEl.play();
            videoEl.classList.add('visible');
        } else {
            videoEl.classList.remove('visible');
            container.classList.add('changing-bg'); 

            setTimeout(() => {
                videoEl.pause();
                videoEl.src = ""; 
                container.style.setProperty('--bg-url', `url('${url}')`);
                container.classList.remove('changing-bg'); 
            }, 400);
        }
    };

    if (!serverId) {
        applyBackground(DEFAULT_BG_LOCAL, false);
        return;
    }

    const timestamp = new Date().getTime();

    function tryLoadExtension(index) {
        if (index >= ALLOWED_EXTENSIONS.length) {
            console.warn(`Fondo no encontrado para ${serverId}. Usando default.`);
            applyBackground(DEFAULT_BG_LOCAL, false);
            return;
        }

        const ext = ALLOWED_EXTENSIONS[index];
        const remoteUrl = `${REMOTE_BG_URL}${serverId}${ext}?v=${timestamp}`;
        
        if (ext === '.mp4') {
            const testVideo = document.createElement('video');
            testVideo.onloadeddata = function() { applyBackground(remoteUrl, true); };
            testVideo.onerror = function() { tryLoadExtension(index + 1); };
            testVideo.src = remoteUrl;
        } else {
            const imgLoader = new Image();
            imgLoader.onload = function() { applyBackground(remoteUrl, false); };
            imgLoader.onerror = function() { tryLoadExtension(index + 1); };
            imgLoader.src = remoteUrl;
        }
    }

    tryLoadExtension(0);
}

// ==================================================================================
// FUNCIONES GLOBALES (MODIFICADAS PARA EL FIX DE LOGIN)
// ==================================================================================

async function updateSelectedAccount(authUser){
    if(authUser != null){
        if(authUser.uuid != null){
            document.getElementById('newAvatarButton').style.backgroundImage = `url('https://mc-heads.net/avatar/${authUser.uuid}')`
        }
    } else {
        document.getElementById('newAvatarButton').style.backgroundImage = `none`
    }

    try {
        if(authUser){
            const distro = await DistroAPI.getDistribution();
            await populateSideBarServerList(distro);
            
            if(ConfigManager.getSelectedServer()){
                const serv = distro.getServerById(ConfigManager.getSelectedServer());
                if(document.getElementById('launch_content').style.display !== 'none'){
                    updateSelectedServer(serv);
                }
            }
        }
    } catch (err) {
        console.error("Error recargando whitelist tras login:", err);
    }
}

function updateSelectedServer(serv){
    if(getCurrentView() === VIEWS.settings){
        fullSettingsSave()
    }
    
    if (serv != null) {
        changeServerBackground(serv.rawServer.id);
    } else {
        changeServerBackground(null);
    }

    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    ConfigManager.save()

    const titleEl = document.getElementById('server_title_text');
    if(titleEl) {
        if (serv != null) {
            titleEl.innerText = serv.rawServer.name; 
            titleEl.style.opacity = "1";
            titleEl.style.display = "block"; 
        } else {
            titleEl.innerText = "Selecciona Servidor";
            titleEl.style.opacity = "0.5";
        }
    }

    const descEl = document.getElementById('selected_version_text');
    if(descEl) {
        if (serv != null) {
             descEl.innerHTML = serv.rawServer.description || serv.rawServer.id;
             descEl.style.color = "#aaa"; 
             descEl.style.display = "block"; 
        } else {
             descEl.innerHTML = "";
        }
    }

    const serverButtons = document.getElementsByClassName('sideBarServerButton');
    for(let i = 0; i < serverButtons.length; i++) {
        if(serv != null && serverButtons[i].getAttribute('data-server-id') === serv.rawServer.id) {
            serverButtons[i].setAttribute('selected', 'true');
        } else {
            serverButtons[i].removeAttribute('selected');
        }
    }

    if(getCurrentView() === VIEWS.settings){
        animateSettingsTabRefresh()
    }
    setLaunchEnabled(serv != null)
}

// ==================================================================================
// === XEONY WHITELIST SYSTEM (MODO DIOS + BLOQUEO TOTAL) ===
// ==================================================================================
const WHITELIST_BASE_URL = "http://va1.holy.gg:26403/launcherfiles/whitelist/";

async function populateSideBarServerList(distro) {
    const container = document.getElementById('sideBarServerList');
    if (!container) return;

    container.innerHTML = ''; 

    const account = ConfigManager.getSelectedAccount();
    if (!account) return; 

    const username = account.displayName.trim().toLowerCase();
    const timestamp = Date.now();

    // 1. VERIFICAR SI ES ADMIN GLOBAL
    let isAdmin = false;
    try {
        const adminRes = await fetch(`${WHITELIST_BASE_URL}admins.txt?v=${timestamp}`);
        if (adminRes.ok) {
            const adminText = await adminRes.text();
            const adminList = adminText.split(/\r?\n/).map(line => line.trim().toLowerCase());
            if (adminList.includes(username)) {
                console.log("Modo Admin activado para:", username);
                isAdmin = true;
            }
        }
    } catch (err) {
        console.warn("No se pudo leer admins.txt");
    }

    // 2. FILTRAR SERVIDORES
    const servers = distro.servers;
    const selectedServerId = ConfigManager.getSelectedServer();
    let firstValidServer = null;
    let visibleServersCount = 0;

    for (const server of servers) {
        let canSeeServer = false;

        if (isAdmin) {
            canSeeServer = true;
        } else {
            try {
                const serverId = server.rawServer.id;
                const url = `${WHITELIST_BASE_URL}${serverId}.txt?v=${timestamp}`;
                const res = await fetch(url);
                
                if (res.ok) {
                    const content = await res.text();
                    const lowerContent = content.toLowerCase();

                    if (lowerContent.includes("server-open")) {
                        canSeeServer = true;
                    } else {
                        const userList = lowerContent.split(/\r?\n/).map(u => u.trim());
                        if (userList.includes(username)) {
                            canSeeServer = true;
                        }
                    }
                } 
            } catch (err) {
                console.warn(`Error verificando whitelist de ${server.rawServer.name}`);
            }
        }

        // 3. DIBUJAR EL BOTÓN
        if (canSeeServer) {
            visibleServersCount++;
            if (!firstValidServer) firstValidServer = server;

            const serverButton = document.createElement('button');
            serverButton.className = 'sideBarServerButton';
            serverButton.style.backgroundImage = `url('${server.rawServer.icon}')`;
            serverButton.setAttribute('data-server-id', server.rawServer.id);
            serverButton.setAttribute('title', server.rawServer.name);

            serverButton.onclick = () => {
                if(getCurrentView() === VIEWS.landing) {
                    updateSelectedServer(server);
                }
            };

            if(server.rawServer.id === selectedServerId) {
                serverButton.setAttribute('selected', 'true');
                changeServerBackground(server.rawServer.id);
            }

            container.appendChild(serverButton);
        }
    }
    
    // 4. MANEJO DE BLOQUEO TOTAL
    if (visibleServersCount === 0) {
        updateSelectedServer(null);
        const launchContent = document.getElementById('launch_content');
        if(launchContent) launchContent.style.display = 'none';
        
        const titleEl = document.getElementById('server_title_text');
        if(titleEl) titleEl.style.display = 'none';
        const descEl = document.getElementById('selected_version_text');
        if(descEl) descEl.style.display = 'none';

        const markup = `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 20px;">
                <div style="text-align: center; color: #ddd; font-size: 14px;">
                    No estás en la lista de ningún servidor.<br>
                    Contacta a un administrador o cambia de cuenta.
                </div>
                <div style="display: flex; gap: 15px; margin-top: 10px;">
                    <button id="btn_force_quit" class="xeony-round-btn" style="border: 1px solid #fff;">
                        Cerrar Launcher
                    </button>
                    <button id="btn_force_logout" class="xeony-round-btn" style="border: 1px solid #ff5555; color: #ff5555; box-shadow: 0 0 10px rgba(255,0,0,0.2);">
                        Cerrar Sesión
                    </button>
                </div>
            </div>
        `;

        setOverlayContent(
            '¡No hay nada aquí!', 
            markup,
            null, 
            null
        );

        setTimeout(() => {
            document.getElementById('btn_force_quit').onclick = () => {
                const { remote } = require('electron');
                remote.app.quit();
            };

            document.getElementById('btn_force_logout').onclick = async () => {
                const uuid = ConfigManager.getSelectedAccount().uuid;
                const type = ConfigManager.getSelectedAccount().type;

                if (type === 'microsoft') {
                    await AuthManager.removeMicrosoftAccount(uuid);
                } else {
                    await AuthManager.removeMojangAccount(uuid);
                }
                
                ConfigManager.save();
                toggleOverlay(false);
                loginOptionsCancelEnabled(false); 
                switchView(getCurrentView(), VIEWS.loginOptions);
            };
        }, 50);

        setOverlayHandler(() => {}); 
        setDismissHandler(() => {}); 
        toggleOverlay(true);

    } else {
        // --- FIX DEL BUG VISUAL ---
        // Solo mostramos el botón JUGAR si el juego NO se está ejecutando/descargando
        if (!isGameRunning) {
            const launchContent = document.getElementById('launch_content');
            if(launchContent) launchContent.style.display = 'flex';
        }

        const currentButton = container.querySelector(`[data-server-id="${selectedServerId}"]`);
        if (!currentButton && firstValidServer) {
            updateSelectedServer(firstValidServer);
        } else if (!selectedServerId && firstValidServer) {
            updateSelectedServer(firstValidServer);
        }
    }
}


// ==================================================================================
// INIT
// ==================================================================================
document.addEventListener('DOMContentLoaded', () => {

    startLoadingTextCycle();

    launch_content = document.getElementById('launch_content')
    launch_details = document.getElementById('launch_details')
    launch_progress = document.getElementById('launch_progress')
    launch_progress_label = document.getElementById('launch_progress_label')
    launch_details_text = document.getElementById('launch_details_text')
    
    document.getElementById('launch_button').addEventListener('click', async e => {
        loggerLanding.info('Launching game..')
        
        // --- ACTIVAR ESTADO DE EJECUCIÓN ---
        isGameRunning = true; 
        // ----------------------------------

        try {
            const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
            const jExe = ConfigManager.getJavaExecutable(ConfigManager.getSelectedServer())
            if(jExe == null){
                await asyncSystemScan(server.effectiveJavaOptions)
            } else {
                setLaunchDetails(Lang.queryJS('landing.launch.pleaseWait'))
                toggleLaunchArea(true)
                setLaunchPercentage(0, 100)

                const details = await window.validateSelectedJvm(window.ensureJavaDirIsRoot(jExe), server.effectiveJavaOptions.supported)
                if(details != null){
                    loggerLanding.info('Jvm Details', details)
                    await dlAsync()
                } else {
                    await asyncSystemScan(server.effectiveJavaOptions)
                }
            }
        } catch(err) {
            // Si hay error al inicio, desactivamos el estado
            isGameRunning = false;
            loggerLanding.error('Unhandled error in during launch process.', err)
            showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
        }
    })

    document.getElementById('settingsMediaButton').onclick = async e => {
        await prepareSettings()
        switchView(getCurrentView(), VIEWS.settings)
    }

    document.getElementById('newAvatarButton').onclick = async e => {
        await prepareSettings()
        switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
            settingsNavItemListener(document.getElementById('settingsNavAccount'), false)
        })
    }
    
    updateSelectedAccount(ConfigManager.getSelectedAccount())

    setTimeout(() => {
        finishLoadingText();
    }, 3000);
    
    // --- INICIO CON CARGA ASÍNCRONA (WHITELIST) ---
    setTimeout(() => {
       DistroAPI.getDistribution().then(async (distro) => {
           await populateSideBarServerList(distro);
           
           if(ConfigManager.getSelectedServer()){
               const serv = distro.getServerById(ConfigManager.getSelectedServer());
               // Solo actualizamos textos si no está bloqueado
               if(document.getElementById('launch_content').style.display !== 'none'){
                   updateSelectedServer(serv);
               }
           }
       });
    }, 1000); 

});


// ==================================================================================
// EL RESTO DE FUNCIONES
// ==================================================================================

function toggleLaunchArea(loading){
    if(loading){
        launch_details.style.display = 'flex'
        launch_content.style.display = 'none'
    } else {
        launch_details.style.display = 'none'
        launch_content.style.display = 'flex'
    }
}

function setLaunchDetails(details){
    launch_details_text.innerHTML = details
}

function setLaunchPercentage(percent){
    launch_progress.setAttribute('max', 100)
    launch_progress.setAttribute('value', percent)
    launch_progress_label.innerHTML = percent + '%'
}

function setDownloadPercentage(percent){
    remote.getCurrentWindow().setProgressBar(percent/100)
    setLaunchPercentage(percent)
}

function setLaunchEnabled(val){
    document.getElementById('launch_button').disabled = !val
}

function showLaunchFailure(title, desc){
    // En caso de fallo, liberamos el estado
    isGameRunning = false; 
    setOverlayContent(title, desc, Lang.queryJS('landing.launch.okay'))
    setOverlayHandler(null)
    toggleOverlay(true)
    toggleLaunchArea(false)
}

async function asyncSystemScan(effectiveJavaOptions, launchAfter = true){
    setLaunchDetails(Lang.queryJS('landing.systemScan.checking'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)
    const jvmDetails = await window.discoverBestJvmInstallation(ConfigManager.getDataDirectory(), effectiveJavaOptions.supported)
    if(jvmDetails == null) {
        setOverlayContent(Lang.queryJS('landing.systemScan.noCompatibleJava'), Lang.queryJS('landing.systemScan.installJavaMessage', { 'major': effectiveJavaOptions.suggestedMajor }), Lang.queryJS('landing.systemScan.installJava'), Lang.queryJS('landing.systemScan.installJavaManually'))
        setOverlayHandler(() => {
            setLaunchDetails(Lang.queryJS('landing.systemScan.javaDownloadPrepare'))
            toggleOverlay(false)
            try {
                downloadJava(effectiveJavaOptions, launchAfter)
            } catch(err) {
                // Error en descarga de Java
                isGameRunning = false;
                loggerLanding.error('Unhandled error in Java Download', err)
                showLaunchFailure(Lang.queryJS('landing.systemScan.javaDownloadFailureTitle'), Lang.queryJS('landing.systemScan.javaDownloadFailureText'))
            }
        })
        setDismissHandler(() => {
            $('#overlayContent').fadeOut(250, () => {
                setOverlayContent(Lang.queryJS('landing.systemScan.javaRequired', { 'major': effectiveJavaOptions.suggestedMajor }), Lang.queryJS('landing.systemScan.javaRequiredMessage', { 'major': effectiveJavaOptions.suggestedMajor }), Lang.queryJS('landing.systemScan.javaRequiredDismiss'), Lang.queryJS('landing.systemScan.javaRequiredCancel'))
                setOverlayHandler(() => {
                    // Cancelado por usuario
                    isGameRunning = false;
                    toggleLaunchArea(false)
                    toggleOverlay(false)
                })
                setDismissHandler(() => {
                    toggleOverlay(false, true)
                    asyncSystemScan(effectiveJavaOptions, launchAfter)
                })
                $('#overlayContent').fadeIn(250)
            })
        })
        toggleOverlay(true, true)
    } else {
        const javaExec = window.javaExecFromRoot(jvmDetails.path)
        ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), javaExec)
        ConfigManager.save()
        settingsJavaExecVal.value = javaExec
        await populateJavaExecDetails(settingsJavaExecVal.value)
        if(launchAfter){
            await dlAsync()
        }
    }
}

async function downloadJava(effectiveJavaOptions, launchAfter = true) {
    const asset = await window.latestOpenJDK(effectiveJavaOptions.suggestedMajor, ConfigManager.getDataDirectory(), effectiveJavaOptions.distribution)
    if(asset == null) { 
        isGameRunning = false;
        throw new Error(Lang.queryJS('landing.downloadJava.findJdkFailure')) 
    }
    let received = 0
    await downloadFile(asset.url, asset.path, ({ transferred }) => {
        received = transferred
        setDownloadPercentage(Math.trunc((transferred/asset.size)*100))
    })
    setDownloadPercentage(100)
    if(received != asset.size) {
        loggerLanding.warn(`Java Download: Expected ${asset.size} bytes but received ${received}`)
        if(!await validateLocalFile(asset.path, asset.algo, asset.hash)) {
            isGameRunning = false;
            log.error(`Hashes do not match, ${asset.id} may be corrupted.`)
            throw new Error(Lang.queryJS('landing.downloadJava.javaDownloadCorruptedError'))
        }
    }
    remote.getCurrentWindow().setProgressBar(2)
    const eLStr = Lang.queryJS('landing.downloadJava.extractingJava')
    let dotStr = ''
    setLaunchDetails(eLStr)
    const extractListener = setInterval(() => {
        if(dotStr.length >= 3){ dotStr = '' } else { dotStr += '.' }
        setLaunchDetails(eLStr + dotStr)
    }, 750)
    const newJavaExec = await window.extractJdk(asset.path)
    remote.getCurrentWindow().setProgressBar(-1)
    ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), newJavaExec)
    ConfigManager.save()
    clearInterval(extractListener)
    setLaunchDetails(Lang.queryJS('landing.downloadJava.javaInstalled'))
    asyncSystemScan(effectiveJavaOptions, launchAfter)
}

let proc, hasRPC = false
const GAME_JOINED_REGEX = /\[.+\]: Sound engine started/
const GAME_LAUNCH_REGEX = /^\[.+\]: (?:MinecraftForge .+ Initialized|ModLauncher .+ starting: .+|Loading Minecraft .+ with Fabric Loader .+)$/
const MIN_LINGER = 5000

async function dlAsync(login = true) {
    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')
    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo'))
    let distro
    try {
        distro = await DistroAPI.refreshDistributionOrFallback()
        onDistroRefresh(distro) 
    } catch(err) {
        isGameRunning = false; // Error
        loggerLaunchSuite.error('Unable to refresh distribution index.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'))
        return
    }
    const serv = distro.getServerById(ConfigManager.getSelectedServer())
    if(login) {
        if(ConfigManager.getSelectedAccount() == null){
            isGameRunning = false; // Error
            loggerLanding.error('You must be logged into an account.')
            return
        }
    }
    setLaunchDetails(Lang.queryJS('landing.dlAsync.pleaseWait'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)
    const fullRepairModule = new FullRepair(ConfigManager.getCommonDirectory(), ConfigManager.getInstanceDirectory(), ConfigManager.getLauncherDirectory(), ConfigManager.getSelectedServer(), DistroAPI.isDevMode())
    fullRepairModule.spawnReceiver()
    fullRepairModule.childProcess.on('error', (err) => {
        isGameRunning = false; // Error
        loggerLaunchSuite.error('Error during launch', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.message || Lang.queryJS('landing.dlAsync.errorDuringLaunchText'))
    })
    fullRepairModule.childProcess.on('close', (code, _signal) => {
        if(code !== 0){
            isGameRunning = false; // Error
            loggerLaunchSuite.error(`Full Repair Module exited with code ${code}, assuming error.`)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        }
    })
    loggerLaunchSuite.info('Validating files.')
    setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
    let invalidFileCount = 0
    try {
        invalidFileCount = await fullRepairModule.verifyFiles(percent => { setLaunchPercentage(percent) })
        setLaunchPercentage(100)
    } catch (err) {
        isGameRunning = false; // Error
        loggerLaunchSuite.error('Error during file validation.')
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileVerificationTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        return
    }
    if(invalidFileCount > 0) {
        loggerLaunchSuite.info('Downloading files.')
        setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingFiles'))
        setLaunchPercentage(0)
        try {
            await fullRepairModule.download(percent => { setDownloadPercentage(percent) })
            setDownloadPercentage(100)
        } catch(err) {
            isGameRunning = false; // Error
            loggerLaunchSuite.error('Error during file download.')
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
            return
        }
    } else {
        loggerLaunchSuite.info('No invalid files, skipping download.')
    }
    remote.getCurrentWindow().setProgressBar(-1)
    fullRepairModule.destroyReceiver()
    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))
    const mojangIndexProcessor = new MojangIndexProcessor(ConfigManager.getCommonDirectory(), serv.rawServer.minecraftVersion)
    const distributionIndexProcessor = new DistributionIndexProcessor(ConfigManager.getCommonDirectory(), distro, serv.rawServer.id)
    const modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(serv)
    const versionData = await mojangIndexProcessor.getVersionJson()
    if(login) {
        const authUser = ConfigManager.getSelectedAccount()
        loggerLaunchSuite.info(`Sending selected account (${authUser.displayName}) to ProcessBuilder.`)
        let pb = new ProcessBuilder(serv, versionData, modLoaderData, authUser, remote.app.getVersion())
        setLaunchDetails(Lang.queryJS('landing.dlAsync.launchingGame'))
        const SERVER_JOINED_REGEX = new RegExp(`\\[.+\\]: \\[CHAT\\] ${authUser.displayName} joined the game`)
        const onLoadComplete = () => {
            toggleLaunchArea(false)

            // --- Jugar Deshabilitado cuando esta en ejecución ---
            const launchBtn = document.getElementById('launch_button')
            launchBtn.disabled = true 
            launchBtn.innerHTML = 'EN EJECUCIÓN...'
            launchBtn.style.opacity = "0.5" 
            // ------------------------

            // --- XEONY SECURITY: REGLA DE LOS 30 MINUTOS ---
            const currentAcc = ConfigManager.getSelectedAccount();
            if (currentAcc && (currentAcc.type === 'offline' || currentAcc.meta.type === 'offline')) {
                if (!ConfigManager.get('xeony_first_launch_time')) {
                    ConfigManager.set('xeony_first_launch_time', Date.now());
                    ConfigManager.save();
                    console.log("XeonySecurity: Primera vez jugando registrada.");
                }
            }
            // -----------------------------------------------

            if(hasRPC){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.loading'))
                proc.stdout.on('data', gameStateChange)
            }
            proc.stdout.removeListener('data', tempListener)
            proc.stderr.removeListener('data', gameErrorListener)
        }
        const start = Date.now()
        const tempListener = function(data){
            if(GAME_LAUNCH_REGEX.test(data.trim())){
                const diff = Date.now()-start
                if(diff < MIN_LINGER) { setTimeout(onLoadComplete, MIN_LINGER-diff) } else { onLoadComplete() }
            }
        }
        const gameStateChange = function(data){
            data = data.trim()
            if(SERVER_JOINED_REGEX.test(data)){ DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joined')) } else if(GAME_JOINED_REGEX.test(data)){ DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joining')) }
        }
        const gameErrorListener = function(data){
            data = data.trim()
            if(data.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1){
                isGameRunning = false; // Error
                loggerLaunchSuite.error('Game launch failed, LaunchWrapper was not downloaded properly.')
                showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.launchWrapperNotDownloaded'))
            }
        }
        try {
            proc = pb.build()
            // --- Reactivar Jugar al cerrar ---
            proc.on('close', (code, signal) => {
                isGameRunning = false; // Juego cerrado, estado libre
                const launchBtn = document.getElementById('launch_button')
                launchBtn.disabled = false 
                launchBtn.innerHTML = 'JUGAR' 
                launchBtn.style.opacity = "1"
                proc = null 
            })
            // ------------------------
            proc.stdout.on('data', tempListener)
            proc.stderr.on('data', gameErrorListener)
            setLaunchDetails(Lang.queryJS('landing.dlAsync.doneEnjoyServer'))
            if(distro.rawDistribution.discord != null && serv.rawServer.discord != null){
                DiscordWrapper.initRPC(distro.rawDistribution.discord, serv.rawServer.discord)
                hasRPC = true
                proc.on('close', (code, signal) => {
                    loggerLaunchSuite.info('Shutting down Discord Rich Presence..')
                    DiscordWrapper.shutdownRPC()
                    hasRPC = false
                    proc = null
                })
            }
        } catch(err) {
            isGameRunning = false; // Error
            loggerLaunchSuite.error('Error during launch', err)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.checkConsoleForDetails'))
        }
    }
}