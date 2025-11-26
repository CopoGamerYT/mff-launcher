const loginOptionsCancelContainer = document.getElementById('loginOptionCancelContainer')
const loginOptionMicrosoft = document.getElementById('loginOptionMicrosoft')
const loginOptionMojang = document.getElementById('loginOptionMojang')
const loginOptionsCancelButton = document.getElementById('loginOptionCancelButton')

let loginOptionsCancellable = false

let loginOptionsViewOnLoginSuccess
let loginOptionsViewOnLoginCancel
let loginOptionsViewOnCancel
let loginOptionsViewCancelHandler

function loginOptionsCancelEnabled(val){
    if(val){
        $(loginOptionsCancelContainer).show()
    } else {
        $(loginOptionsCancelContainer).hide()
    }
}

loginOptionMicrosoft.onclick = (e) => {
    switchView(getCurrentView(), VIEWS.waiting, 500, 500, () => {
        ipcRenderer.send(
            MSFT_OPCODE.OPEN_LOGIN,
            loginOptionsViewOnLoginSuccess,
            loginOptionsViewOnLoginCancel
        )
    })
}

loginOptionMojang.onclick = (e) => {
    switchView(getCurrentView(), VIEWS.login, 500, 500, () => {
        loginViewOnSuccess = loginOptionsViewOnLoginSuccess
        loginViewOnCancel = loginOptionsViewOnLoginCancel
        loginCancelEnabled(true)
    })
}

loginOptionsCancelButton.onclick = (e) => {
    switchView(getCurrentView(), loginOptionsViewOnCancel, 500, 500, () => {
        loginUsername.value = ''
        loginPassword.value = ''
        if(loginOptionsViewCancelHandler != null){
            loginOptionsViewCancelHandler()
            loginOptionsViewCancelHandler = null
        }
    })
}

// ==========================================================================
// =========== XEONY SECURITY: SISTEMA NO PREMIUM AVANZADO ===========
// ==========================================================================

const BLACKLIST_URL = "http://va1.holy.gg:26403/launcherfiles/blacklist.txt";
const OFFLINE_COOLDOWN = 1000 * 60 * 60 * 24 * 30; // 30 Días

function isValidOfflineName(name) {
    const regex = /^[a-zA-Z0-9_]{3,16}$/;
    return regex.test(name);
}

function getOfflineUUID(name) {
    return '00000000-0000-0000-0000-' + Date.now().toString(16).padStart(12, '0');
}

async function fetchRemoteBlacklist() {
    try {
        const response = await fetch(BLACKLIST_URL + '?v=' + Date.now());
        if (response.ok) {
            const text = await response.text();
            return text.split(/\r?\n/).map(line => line.trim().toLowerCase()).filter(line => line.length > 0);
        }
    } catch (error) {
        console.error("Error obteniendo blacklist:", error);
    }
    return ['admin', 'soporte', 'root'];
}

const noPremiumBtn = document.getElementById('noPremiumBtn');

if (noPremiumBtn) {
    noPremiumBtn.onclick = async (e) => {
        
        // --- VERIFICACIÓN DE BLOQUEO Y OPORTUNIDAD ---
        const lastReg = ConfigManager.get('xeony_offline_lock');
        const chanceUsed = ConfigManager.get('xeony_chance_used'); 
        const now = Date.now();

        // Si hay bloqueo activo...
        if (lastReg && (now - lastReg) < OFFLINE_COOLDOWN) {
            
            // Calcular fecha exacta de desbloqueo
            const unlockDate = new Date(lastReg + OFFLINE_COOLDOWN);
            const dateString = unlockDate.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            const timeString = unlockDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

            // --- NUEVO: VALIDACIÓN DE TIEMPO JUGADO (30 MINUTOS) ---
            const firstLaunchTime = ConfigManager.get('xeony_first_launch_time');
            const TIME_LIMIT_MINUTES = 30;
            // Si existe registro de juego Y han pasado más de 30 mins -> True
            const hasPlayedTooLong = firstLaunchTime && (now - firstLaunchTime) > (TIME_LIMIT_MINUTES * 60 * 1000);

            // CASO A: TIENE DERECHO A OPORTUNIDAD 
            // (No la ha gastado Y no ha jugado demasiado tiempo)
            if (!chanceUsed && !hasPlayedTooLong) {
                
                const chanceMarkup = `
                    <div style="text-align: center; color: #ddd; display: flex; flex-direction: column; gap: 15px; align-items: center;">
                        <div style="font-size: 14px;">
                            Ya registraste una cuenta en este dispositivo.<br>
                            Sin embargo, tienes <b style="color: #55ff55;">1 OPORTUNIDAD</b> para corregir tu nombre.
                        </div>
                        
                        <div style="font-size: 11px; color: #aaa;">
                            (Esta opción desaparecerá si juegas más de 30 min con tu cuenta actual)
                        </div>

                        <div style="background: rgba(255, 170, 0, 0.2); border: 1px solid #ffaa00; border-radius: 10px; padding: 10px; font-size: 12px; color: #ffcc80; width: 100%;">
                            ⚠ <b>ADVERTENCIA:</b> Si usas esta oportunidad, el bloqueo será definitivo hasta el:
                            <br><b style="color: white; font-size: 13px; display: block; margin-top: 5px;">${dateString} a las ${timeString}</b>
                        </div>
                        <div style="display: flex; gap: 15px; margin-top: 10px;">
                            <button id="btn_cancel_chance" class="xeony-round-btn" style="border: 1px solid #aaa;">Cancelar</button>
                            <button id="btn_use_chance" class="xeony-round-btn" style="background: #4caf50; color: white; border: none; box-shadow: 0 0 10px rgba(76, 175, 80, 0.4);">Corregir Nombre</button>
                        </div>
                    </div>
                `;

                setOverlayContent('¿Te equivocaste de nombre?', chanceMarkup, null, null);
                
                setTimeout(() => {
                    document.getElementById('btn_cancel_chance').onclick = () => toggleOverlay(false);
                    
                    document.getElementById('btn_use_chance').onclick = () => {
                        toggleOverlay(false);
                        showOfflineForm(true); // true = Marcar que ESTÁ usando la oportunidad
                    };
                }, 50);
                
                toggleOverlay(true);
                return;
            }

            // CASO B: BLOQUEO TOTAL 
            // (Ya gastó la oportunidad O ya jugó mucho tiempo)
            const lockMarkup = `
                <div style="text-align: center; color: #ccc; display: flex; flex-direction: column; gap: 10px; align-items: center;">
                    <div style="font-size: 14px;">
                        Has alcanzado el límite de cuentas en este dispositivo.
                    </div>
                    <div style="margin-top: 10px; margin-bottom: 10px;">
                        Podrás registrar una nueva cuenta el día:<br>
                        <span style="font-size: 18px; font-weight: bold; color: #ff5555; text-shadow: 0 0 10px rgba(255,0,0,0.3); display: block; margin-top: 5px;">
                            ${dateString}
                        </span>
                        <span style="font-size: 14px; color: #ff8888;">a las ${timeString}</span>
                    </div>
                    <button id="btn_lock_ok" class="xeony-round-btn" style="border: 1px solid #fff; margin-top: 10px;">Entendido</button>
                </div>
            `;

            setOverlayContent('Acceso Limitado', lockMarkup, null, null);
            setTimeout(() => {
                document.getElementById('btn_lock_ok').onclick = () => toggleOverlay(false);
            }, 50);
            toggleOverlay(true);
            return;
        }

        // Si no hay bloqueo, mostrar formulario normal
        showOfflineForm(false);
    };
}

// --- FUNCIÓN PARA MOSTRAR EL FORMULARIO DE REGISTRO ---
function showOfflineForm(isUsingChance) {
    
    const loginFormHTML = `
        <div style="position: relative; width: 100%;">
            <div id="close_offline_btn" style="position: absolute; top: -35px; right: 0; cursor: pointer; font-size: 24px; color: #aaa;">&#10006;</div>

            <div style="display: flex; flex-direction: column; align-items: center; gap: 15px; width: 100%;">
                
                <div style="background: rgba(255, 0, 0, 0.15); border: 1px solid #ff4444; border-radius: 10px; padding: 12px; width: 100%; text-align: center; box-sizing: border-box;">
                    <div style="color: #ff4444; font-weight: bold; font-size: 14px; margin-bottom: 5px;">⚠ IMPORTANTE</div>
                    <div style="color: #ffdcdc; font-size: 12px; line-height: 1.4;">
                        Al iniciar sesión, este PC quedará vinculado a este nombre por <b>30 DÍAS</b>.
                        <br>Verifica que esté bien escrito antes de continuar.
                    </div>
                </div>

                <div style="width: 100%; display: flex; flex-direction: column; gap: 5px;">
                    <label style="color: #ccc; font-size: 12px; margin-left: 5px;">Nombre de Usuario</label>
                    <input id="offline_username" type="text" placeholder="Ej: Steve" 
                        style="padding: 12px; border-radius: 10px; border: 1px solid #444; width: 100%; 
                               background: rgba(0, 0, 0, 0.4); color: white; font-size: 16px; outline: none; 
                               transition: border-color 0.3s; box-sizing: border-box;">
                </div>

                <div id="offline_error" style="color: #ff5555; font-weight: bold; font-size: 13px; min-height: 20px;"></div>
                
                <button id="btn_offline_login" class="xeony-round-btn" style="background: white; color: black; border: none; font-weight: bold; margin-top: 5px; width: 100%;">
                    Iniciar Sesión
                </button>
            </div>
        </div>
        <style>
            #offline_username:focus { border-color: #ffffff !important; }
            #close_offline_btn:hover { color: #ffffff !important; }
        </style>
    `;

    setOverlayContent('Modo No Premium', loginFormHTML, null, null);

    setTimeout(() => {
        document.getElementById('close_offline_btn').onclick = () => toggleOverlay(false);

        document.getElementById('btn_offline_login').onclick = async () => {
            const usernameInput = document.getElementById('offline_username').value.trim();
            const errorDiv = document.getElementById('offline_error');
            const btn = document.getElementById('btn_offline_login');

            btn.disabled = true;
            btn.innerText = "Verificando...";
            btn.style.opacity = "0.7";

            if (!isValidOfflineName(usernameInput)) {
                errorDiv.innerText = "Nombre inválido (3-16 letras/números)";
                btn.disabled = false; btn.innerText = "Iniciar Sesión"; btn.style.opacity = "1";
                return;
            }

            const blacklist = await fetchRemoteBlacklist();
            if (blacklist.some(w => usernameInput.toLowerCase().includes(w))) {
                errorDiv.innerText = "Este nombre no está permitido.";
                btn.disabled = false; btn.innerText = "Iniciar Sesión"; btn.style.opacity = "1";
                return;
            }

            // CREAR CUENTA
            const authUuid = getOfflineUUID(usernameInput);
            const account = {
                access_token: authUuid, client_token: authUuid, uuid: authUuid, name: usernameInput,
                user_properties: [], meta: { type: 'offline', offline: true, displayName: usernameInput }
            };

            try {
                ConfigManager.addAuthAccount(account.uuid, account.access_token, account.name, account.name);
                
                // 1. Reiniciamos el bloqueo de 30 días
                ConfigManager.set('xeony_offline_lock', Date.now());
                
                // 2. Si usó la "segunda oportunidad", la marcamos como gastada PERMANENTEMENTE
                if (isUsingChance) {
                    ConfigManager.set('xeony_chance_used', true);
                }
                
                // 3. IMPORTANTE: Reseteamos el contador de tiempo jugado para la nueva cuenta
                // Para que la lógica de los 30 min empiece de cero con el nuevo nombre
                ConfigManager.set('xeony_first_launch_time', null);

                ConfigManager.save();
                toggleOverlay(false);
                updateSelectedAccount(account);
                
                const nextView = loginOptionsViewOnLoginSuccess || VIEWS.landing;
                switchView(getCurrentView(), nextView, 500, 500);

            } catch (err) {
                console.error(err);
                errorDiv.innerText = "Error interno.";
                btn.disabled = false;
            }
        };
    }, 50);

    toggleOverlay(true);
}