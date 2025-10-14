/**
 * Script for landing.ejs
 */
// Requirements
const { URL }                 = require('url')
const {
    MojangRestAPI,
    getServerStatus
}                             = require('helios-core/mojang')
const {
    RestResponseStatus,
    isDisplayableError,
    validateLocalFile
}                             = require('helios-core/common')
const {
    FullRepair,
    DistributionIndexProcessor,
    MojangIndexProcessor,
    downloadFile
}                             = require('helios-core/dl')
const {
    validateSelectedJvm,
    ensureJavaDirIsRoot,
    javaExecFromRoot,
    discoverBestJvmInstallation,
    latestOpenJDK,
    extractJdk
}                             = require('helios-core/java')

// Internal Requirements
const DiscordWrapper          = require('./assets/js/discordwrapper')
const ProcessBuilder          = require('./assets/js/processbuilder')

// Launch Elements (declarados globalmente para que las funciones los vean)
let launch_content, launch_details, launch_progress, launch_progress_label, launch_details_text, user_text;

const loggerLanding = LoggerUtil.getLogger('Landing')

// ==================================================================================
// FUNCIONES GLOBALES (VISIBLES PARA OTROS ARCHIVOS)
// ==================================================================================

/**
 * Update the selected account element on the UI.
 * * @param {Object} authUser The authenticated user object.
 */
function updateSelectedAccount(authUser){
    let username = Lang.queryJS('landing.selectedAccount.noAccountSelected')
    if(authUser != null){
        if(authUser.displayName != null){
            username = authUser.displayName
        }
        if(authUser.uuid != null){
            document.getElementById('avatarContainer').style.backgroundImage = `url('https://mc-heads.net/avatar/${authUser.uuid}')`
        }
    }
    user_text.innerHTML = `Bienvenido <span class="colored-name">${username}</span>`
}

/**
 * Update the selected server element on the UI.
 * * @param {Object} serv The server object.
 */
function updateSelectedServer(serv){
    if(getCurrentView() === VIEWS.settings){
        fullSettingsSave()
    }
    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    ConfigManager.save()

    document.getElementById('server_selection_icon').src = (serv != null ? serv.rawServer.icon : 'assets/images/SealCircle.png');
    document.getElementById('selected_version_text').innerHTML = 'Versión Seleccionada: "' + (serv != null ? serv.rawServer.name : 'Ninguna') + '"'
    
    if(getCurrentView() === VIEWS.settings){
        animateSettingsTabRefresh()
    }
    setLaunchEnabled(serv != null)
}


// ==================================================================================
// ESTE CÓDIGO SE EJECUTA SOLO CUANDO LA PÁGINA ESTÁ LISTA
// ==================================================================================
document.addEventListener('DOMContentLoaded', () => {

    // Asignamos los elementos del DOM a las variables.
    launch_content = document.getElementById('launch_content')
    launch_details = document.getElementById('launch_details')
    launch_progress = document.getElementById('launch_progress')
    launch_progress_label = document.getElementById('launch_progress_label')
    launch_details_text = document.getElementById('launch_details_text')
    user_text = document.getElementById('user_text')
    
    // Bind launch button
    document.getElementById('launch_button').addEventListener('click', async e => {
        loggerLanding.info('Launching game..')
        try {
            const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
            const jExe = ConfigManager.getJavaExecutable(ConfigManager.getSelectedServer())
            if(jExe == null){
                await asyncSystemScan(server.effectiveJavaOptions)
            } else {
                setLaunchDetails(Lang.queryJS('landing.launch.pleaseWait'))
                toggleLaunchArea(true)
                setLaunchPercentage(0, 100)

                const details = await validateSelectedJvm(ensureJavaDirIsRoot(jExe), server.effectiveJavaOptions.supported)
                if(details != null){
                    loggerLanding.info('Jvm Details', details)
                    await dlAsync()
                } else {
                    await asyncSystemScan(server.effectiveJavaOptions)
                }
            }
        } catch(err) {
            loggerLanding.error('Unhandled error in during launch process.', err)
            showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
        }
    })

    // Bind settings button
    document.getElementById('settingsMediaButton').onclick = async e => {
        await prepareSettings()
        switchView(getCurrentView(), VIEWS.settings)
    }

    // Bind avatar overlay button.
    document.getElementById('avatarOverlay').onclick = async e => {
        await prepareSettings()
        switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
            settingsNavItemListener(document.getElementById('settingsNavAccount'), false)
        })
    }
    
    // Bind server selection icon click
    document.getElementById('server_selection_icon').addEventListener('click', async e => {
        e.target.blur()
        await toggleServerSelection(true)
    })
    
    // Bind news button
    document.getElementById('newsButton').onclick = () => {
        if(newsActive){
            $('#landingContainer *').removeAttr('tabindex')
            $('#newsContainer *').attr('tabindex', '-1')
        } else {
            $('#landingContainer *').attr('tabindex', '-1')
            $('#newsContainer, #newsContainer *, #lower, #lower #center *').removeAttr('tabindex')
            if(newsAlertShown){
                $('#newsButtonAlert').fadeOut(2000)
                newsAlertShown = false
                ConfigManager.setNewsCacheDismissed(true)
                ConfigManager.save()
            }
        }
        slide_(!newsActive)
        newsActive = !newsActive
    }

    // Bind news close button
    document.getElementById('newsCloseButton').addEventListener('click', () => {
        if(newsActive){
            $('#landingContainer *').removeAttr('tabindex')
            $('#newsContainer *').attr('tabindex', '-1')
            slide_(false)
            newsActive = false
        }
    });

    // Llamadas iniciales
    updateSelectedAccount(ConfigManager.getSelectedAccount())
    refreshMojangStatuses()
    let mojangStatusListener = setInterval(() => refreshMojangStatuses(true), 60*60*1000)
    let serverStatusListener = setInterval(() => refreshServerStatus(true), 300000)

});


// ==================================================================================
// EL RESTO DE FUNCIONES PUEDEN VIVIR AFUERA PORQUE SON "INTERNAS" DE ESTE ARCHIVO
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

function slide_(up){
    const newsContainer = document.getElementById('newsContainer');
    const landingContainer = document.getElementById('landingContainer');
    const top_left = document.getElementsByClassName('top-left')[0], top_right = document.getElementsByClassName('top-right')[0], bottom_left = document.getElementsByClassName('bottom-left')[0], bottom_center = document.getElementsByClassName('bottom-center')[0], bottom_right = document.getElementsByClassName('bottom-right')[0];
    if(up){
        top_left.style.top = '-100vh'; top_right.style.top = '-100vh'; bottom_left.style.bottom = '100vh'; bottom_center.style.bottom = '100vh'; bottom_right.style.bottom = '100vh';
        newsContainer.style.top = '0px'; landingContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.50)';
    } else {
        top_left.style.top = ''; top_right.style.top = ''; bottom_left.style.bottom = ''; bottom_center.style.bottom = ''; bottom_right.style.bottom = '';
        newsContainer.style.top = '100%'; landingContainer.style.backgroundColor = null;
    }
}

const refreshMojangStatuses = async function(){
    loggerLanding.info('Refreshing Mojang Statuses..')
    let status = 'grey', tooltipEssentialHTML = '', tooltipNonEssentialHTML = ''
    const response = await MojangRestAPI.status()
    let statuses
    if(response.responseStatus === RestResponseStatus.SUCCESS) {
        statuses = response.data
    } else {
        loggerLanding.warn('Unable to refresh Mojang service status.')
        statuses = MojangRestAPI.getDefaultStatuses()
    }
    let greenCount = 0, greyCount = 0
    for(let i=0; i<statuses.length; i++){
        const service = statuses[i]
        const tooltipHTML = `<div class="mojangStatusContainer"><span class="mojangStatusIcon" style="color: ${MojangRestAPI.statusToHex(service.status)};">&#8226;</span><span class="mojangStatusName">${service.name}</span></div>`
        if(service.essential){ tooltipEssentialHTML += tooltipHTML } else { tooltipNonEssentialHTML += tooltipHTML }
        if(service.status === 'yellow' && status !== 'red'){ status = 'yellow' } else if(service.status === 'red'){ status = 'red' } else { if(service.status === 'grey'){ ++greyCount } ++greenCount }
    }
    if(greenCount === statuses.length){ if(greyCount === statuses.length){ status = 'grey' } else { status = 'green' } }
    document.getElementById('mojangStatusEssentialContainer').innerHTML = tooltipEssentialHTML
    document.getElementById('mojangStatusNonEssentialContainer').innerHTML = tooltipNonEssentialHTML
    document.getElementById('mojang_status_icon').style.color = MojangRestAPI.statusToHex(status)
}

const refreshServerStatus = async (fade = false) => {
    loggerLanding.info('Refreshing Server Status')
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    let pLabel = Lang.queryJS('landing.serverStatus.server'), pVal = Lang.queryJS('landing.serverStatus.offline')
    try {
        const servStat = await getServerStatus(47, serv.hostname, serv.port)
        pLabel = Lang.queryJS('landing.serverStatus.players')
        pVal = servStat.players.online + '/' + servStat.players.max
    } catch (err) {
        loggerLanding.warn('Unable to refresh server status, assuming offline.')
        loggerLanding.debug(err)
    }
    if(fade){
        $('#server_status_wrapper').fadeOut(250, () => {
            document.getElementById('landingPlayerLabel').innerHTML = pLabel
            document.getElementById('player_count').innerHTML = pVal
            $('#server_status_wrapper').fadeIn(500)
        })
    } else {
        document.getElementById('landingPlayerLabel').innerHTML = pLabel
        document.getElementById('player_count').innerHTML = pVal
    }
}

function showLaunchFailure(title, desc){
    setOverlayContent(title, desc, Lang.queryJS('landing.launch.okay'))
    setOverlayHandler(null)
    toggleOverlay(true)
    toggleLaunchArea(false)
}

async function asyncSystemScan(effectiveJavaOptions, launchAfter = true){
    setLaunchDetails(Lang.queryJS('landing.systemScan.checking'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)
    const jvmDetails = await discoverBestJvmInstallation(ConfigManager.getDataDirectory(), effectiveJavaOptions.supported)
    if(jvmDetails == null) {
        setOverlayContent(Lang.queryJS('landing.systemScan.noCompatibleJava'), Lang.queryJS('landing.systemScan.installJavaMessage', { 'major': effectiveJavaOptions.suggestedMajor }), Lang.queryJS('landing.systemScan.installJava'), Lang.queryJS('landing.systemScan.installJavaManually'))
        setOverlayHandler(() => {
            setLaunchDetails(Lang.queryJS('landing.systemScan.javaDownloadPrepare'))
            toggleOverlay(false)
            try {
                downloadJava(effectiveJavaOptions, launchAfter)
            } catch(err) {
                loggerLanding.error('Unhandled error in Java Download', err)
                showLaunchFailure(Lang.queryJS('landing.systemScan.javaDownloadFailureTitle'), Lang.queryJS('landing.systemScan.javaDownloadFailureText'))
            }
        })
        setDismissHandler(() => {
            $('#overlayContent').fadeOut(250, () => {
                setOverlayContent(Lang.queryJS('landing.systemScan.javaRequired', { 'major': effectiveJavaOptions.suggestedMajor }), Lang.queryJS('landing.systemScan.javaRequiredMessage', { 'major': effectiveJavaOptions.suggestedMajor }), Lang.queryJS('landing.systemScan.javaRequiredDismiss'), Lang.queryJS('landing.systemScan.javaRequiredCancel'))
                setOverlayHandler(() => {
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
        const javaExec = javaExecFromRoot(jvmDetails.path)
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
    const asset = await latestOpenJDK(effectiveJavaOptions.suggestedMajor, ConfigManager.getDataDirectory(), effectiveJavaOptions.distribution)
    if(asset == null) { throw new Error(Lang.queryJS('landing.downloadJava.findJdkFailure')) }
    let received = 0
    await downloadFile(asset.url, asset.path, ({ transferred }) => {
        received = transferred
        setDownloadPercentage(Math.trunc((transferred/asset.size)*100))
    })
    setDownloadPercentage(100)
    if(received != asset.size) {
        loggerLanding.warn(`Java Download: Expected ${asset.size} bytes but received ${received}`)
        if(!await validateLocalFile(asset.path, asset.algo, asset.hash)) {
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
    const newJavaExec = await extractJdk(asset.path)
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
        loggerLaunchSuite.error('Unable to refresh distribution index.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'))
        return
    }
    const serv = distro.getServerById(ConfigManager.getSelectedServer())
    if(login) {
        if(ConfigManager.getSelectedAccount() == null){
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
        loggerLaunchSuite.error('Error during launch', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.message || Lang.queryJS('landing.dlAsync.errorDuringLaunchText'))
    })
    fullRepairModule.childProcess.on('close', (code, _signal) => {
        if(code !== 0){
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
                loggerLaunchSuite.error('Game launch failed, LaunchWrapper was not downloaded properly.')
                showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.launchWrapperNotDownloaded'))
            }
        }
        try {
            proc = pb.build()
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
            loggerLaunchSuite.error('Error during launch', err)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.checkConsoleForDetails'))
        }
    }
}

const newsContent = document.getElementById('newsContent')
const newsArticleTitle = document.getElementById('newsArticleTitle')
const newsArticleDate = document.getElementById('newsArticleDate')
const newsArticleAuthor = document.getElementById('newsArticleAuthor')
const newsArticleComments = document.getElementById('newsArticleComments')
const newsNavigationStatus = document.getElementById('newsNavigationStatus')
const newsArticleContentScrollable = document.getElementById('newsArticleContentScrollable')
const nELoadSpan = document.getElementById('nELoadSpan')
let newsActive = false, newsGlideCount = 0

let newsArr = null, newsLoadingListener = null

function setNewsLoading(val){
    if(val){
        const nLStr = Lang.queryJS('landing.news.checking')
        let dotStr = '..'
        nELoadSpan.innerHTML = nLStr + dotStr
        newsLoadingListener = setInterval(() => {
            if(dotStr.length >= 3){ dotStr = '' } else { dotStr += '.' }
            nELoadSpan.innerHTML = nLStr + dotStr
        }, 750)
    } else {
        if(newsLoadingListener != null){ clearInterval(newsLoadingListener); newsLoadingListener = null }
    }
}

newsErrorRetry.onclick = () => {
    $('#newsErrorFailed').fadeOut(250, () => {
        initNews()
        $('#newsErrorLoading').fadeIn(250)
    })
}
newsArticleContentScrollable.onscroll = (e) => {
    if(e.target.scrollTop > Number.parseFloat($('.newsArticleSpacerTop').css('height'))){ newsContent.setAttribute('scrolled', '') } else { newsContent.removeAttribute('scrolled') }
}
function reloadNews(){
    return new Promise((resolve, reject) => {
        $('#newsContent').fadeOut(250, () => {
            $('#newsErrorLoading').fadeIn(250)
            initNews().then(() => { resolve() })
        })
    })
}
let newsAlertShown = false
function showNewsAlert(){
    newsAlertShown = true
    $(newsButtonAlert).fadeIn(250)
}

async function digestMessage(str) {
    const msgUint8 = new TextEncoder().encode(str)
    const hashBuffer = await crypto.subtle.digest('SHA-1', msgUint8)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
    return hashHex
}

async function initNews(){
    setNewsLoading(true)
    const news = await loadNews()
    newsArr = news?.articles || null
    if(newsArr == null){
        setNewsLoading(false)
        await $('#newsErrorLoading').fadeOut(250).promise()
        await $('#newsErrorFailed').fadeIn(250).promise()
    } else if(newsArr.length === 0) {
        setNewsLoading(false)
        ConfigManager.setNewsCache({ date: null, content: null, dismissed: false })
        ConfigManager.save()
        await $('#newsErrorLoading').fadeOut(250).promise()
        await $('#newsErrorNone').fadeIn(250).promise()
    } else {
        setNewsLoading(false)
        const lN = newsArr[0]
        const cached = ConfigManager.getNewsCache()
        let newHash = await digestMessage(lN.content)
        let newDate = new Date(lN.date)
        let isNew = false
        if(cached.date != null && cached.content != null){
            if(new Date(cached.date) >= newDate){
                if(cached.content !== newHash){ isNew = true; showNewsAlert() } else { if(!cached.dismissed){ isNew = true; showNewsAlert() } }
            } else { isNew = true; showNewsAlert() }
        } else { isNew = true; showNewsAlert() }
        if(isNew){
            ConfigManager.setNewsCache({ date: newDate.getTime(), content: newHash, dismissed: false })
            ConfigManager.save()
        }
        const switchHandler = (forward) => {
            let cArt = parseInt(newsContent.getAttribute('article'))
            let nxtArt = forward ? (cArt >= newsArr.length-1 ? 0 : cArt + 1) : (cArt <= 0 ? newsArr.length-1 : cArt - 1)
            displayArticle(newsArr[nxtArt], nxtArt+1)
        }
        document.getElementById('newsNavigateRight').onclick = () => { switchHandler(true) }
        document.getElementById('newsNavigateLeft').onclick = () => { switchHandler(false) }
        await $('#newsErrorContainer').fadeOut(250).promise()
        displayArticle(newsArr[0], 1)
        await $('#newsContent').fadeIn(250).promise()
    }
}

document.addEventListener('keydown', (e) => {
    if(newsActive){
        if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){ document.getElementById(e.key === 'ArrowRight' ? 'newsNavigateRight' : 'newsNavigateLeft').click() }
    } else {
        if(getCurrentView() === VIEWS.landing){ if(e.key === 'ArrowUp'){ document.getElementById('newsButton').click() } }
    }
})

function displayArticle(articleObject, index){
    newsArticleTitle.innerHTML = articleObject.title
    newsArticleTitle.href = articleObject.link
    newsArticleAuthor.innerHTML = 'by ' + articleObject.author
    newsArticleDate.innerHTML = articleObject.date
    newsArticleComments.innerHTML = articleObject.comments
    newsArticleComments.href = articleObject.commentsLink
    newsArticleContentScrollable.innerHTML = '<div id="newsArticleContentWrapper"><div class="newsArticleSpacerTop"></div>' + articleObject.content + '<div class="newsArticleSpacerBot"></div></div>'
    Array.from(newsArticleContentScrollable.getElementsByClassName('bbCodeSpoilerButton')).forEach(v => {
        v.onclick = () => {
            const text = v.parentElement.getElementsByClassName('bbCodeSpoilerText')[0]
            text.style.display = text.style.display === 'block' ? 'none' : 'block'
        }
    })
    newsNavigationStatus.innerHTML = Lang.query('ejs.landing.newsNavigationStatus', {currentPage: index, totalPages: newsArr.length})
    newsContent.setAttribute('article', index-1)
}

async function loadNews(){
    const distroData = await DistroAPI.getDistribution()
    if(!distroData.rawDistribution.rss) {
        loggerLanding.debug('No RSS feed provided.')
        return null
    }
    const promise = new Promise((resolve, reject) => {
        const newsFeed = distroData.rawDistribution.rss
        const newsHost = new URL(newsFeed).origin + '/'
        $.ajax({
            url: newsFeed,
            success: (data) => {
                const items = $(data).find('item')
                const articles = []
                for(let i=0; i<items.length; i++){
                    const el = $(items[i])
                    const date = new Date(el.find('pubDate').text()).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric'})
                    let comments = el.find('slash\\:comments').text() || '0'
                    comments = comments + ' Comment' + (comments === '1' ? '' : 's')
                    let content = el.find('content\\:encoded').text()
                    let regex = /src="(?!http:\/\/|https:\/\/)(.+?)"/g
                    let matches
                    while((matches = regex.exec(content))){ content = content.replace(`"${matches[1]}"`, `"${newsHost + matches[1]}"`) }
                    let link   = el.find('link').text()
                    let title  = el.find('title').text()
                    let author = el.find('dc\\:creator').text()
                    articles.push({ link, title, date, author, content, comments, commentsLink: link + '#comments' })
                }
                resolve({ articles })
            },
            timeout: 2500
        }).catch(err => {
            resolve({ articles: null })
        })
    })
    return await promise
}