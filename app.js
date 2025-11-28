// Configuration
const API_URL = 'http://localhost:8000/predict-price';

// DOM Elements
const form = document.getElementById('prediction-form');
const resultPanel = document.getElementById('result-panel');
const emptyState = document.getElementById('empty-state');
const loadingState = document.getElementById('loading-state');
const resultContent = document.getElementById('result-content');
const priceValue = document.getElementById('price-value');
const rangeLow = document.getElementById('range-low');
const rangeHigh = document.getElementById('range-high');
const summaryList = document.getElementById('summary-list');
const bandFill = document.querySelector('.band-bar .fill');

// State
let chartInstance = null;

// --- Three.js Background ---
const initThreeJS = () => {
    const container = document.getElementById('canvas-container');
    const scene = new THREE.Scene();

    // Camera - Centered and slightly pulled back
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 18;
    camera.position.x = 0; // Perfectly centered
    camera.position.y = 0;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);

    // Globe Group
    const globeGroup = new THREE.Group();
    scene.add(globeGroup);

    // Texture Loader
    const textureLoader = new THREE.TextureLoader();

    // High-quality Earth Night Lights
    const nightTexture = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_lights_2048.png');
    const bumpMap = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_normal_2048.jpg');
    const specularMap = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_specular_2048.jpg');

    // 1. Earth Sphere (Night)
    const geometry = new THREE.SphereGeometry(6, 64, 64);

    const material = new THREE.MeshPhongMaterial({
        map: nightTexture,
        bumpMap: bumpMap,
        bumpScale: 0.05,
        specularMap: specularMap,
        specular: new THREE.Color(0x333333),
        shininess: 5,
        emissive: new THREE.Color(0xffff88), // Warm city lights
        emissiveMap: nightTexture,
        emissiveIntensity: 0.6,
        color: 0x000000 // Dark base for oceans
    });

    const earth = new THREE.Mesh(geometry, material);
    globeGroup.add(earth);

    // 2. Atmosphere Glow (Fresnel-like effect)
    const atmosGeometry = new THREE.SphereGeometry(6.2, 64, 64);
    const atmosMaterial = new THREE.ShaderMaterial({
        uniforms: {
            c: { type: "f", value: 0.6 },
            p: { type: "f", value: 4.0 },
            glowColor: { type: "c", value: new THREE.Color(0x00f2ff) },
            viewVector: { type: "v3", value: camera.position }
        },
        vertexShader: `
            uniform vec3 viewVector;
            varying float intensity;
            void main() {
                vec3 vNormal = normalize(normalMatrix * normal);
                vec3 vNormel = normalize(normalMatrix * viewVector);
                intensity = pow(0.55 - dot(vNormal, vNormel), 4.0);
                gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
            }
        `,
        fragmentShader: `
            uniform vec3 glowColor;
            varying float intensity;
            void main() {
                vec3 glow = glowColor * intensity;
                gl_FragColor = vec4( glow, 1.0 );
            }
        `,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true
    });

    const atmosphere = new THREE.Mesh(atmosGeometry, atmosMaterial);
    globeGroup.add(atmosphere);

    // 3. Stars
    const starsGeometry = new THREE.BufferGeometry();
    const starsCount = 3000;
    const posArray = new Float32Array(starsCount * 3);

    for (let i = 0; i < starsCount * 3; i++) {
        posArray[i] = (Math.random() - 0.5) * 80;
    }

    starsGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    const starsMaterial = new THREE.PointsMaterial({
        size: 0.08,
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending
    });
    const stars = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(stars);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x111111); // Very dark ambient
    scene.add(ambientLight);

    // Rim light from left/back
    const spotLight = new THREE.SpotLight(0x00f2ff, 2);
    spotLight.position.set(-20, 10, 10);
    spotLight.lookAt(globeGroup.position);
    scene.add(spotLight);

    // Animation Variables
    let mouseX = 0;
    let mouseY = 0;
    let targetParallaxX = 0;
    let targetParallaxY = 0;
    let isHovering = false;
    let isLocked = false;
    let targetLockRotationX = 0;
    let targetLockRotationY = 0;

    // Base rotation accumulator
    let baseRotationY = 0;

    const canvasElement = renderer.domElement;

    // Mouse Move
    canvasElement.addEventListener('mousemove', (event) => {
        // Normalized coordinates for parallax target
        mouseX = (event.clientX - window.innerWidth / 2) * 0.0001;
        mouseY = (event.clientY - window.innerHeight / 2) * 0.0001;
    });

    // Hover detection
    canvasElement.addEventListener('mouseenter', () => { isHovering = true; });
    canvasElement.addEventListener('mouseleave', () => { isHovering = false; });

    // Click to lock/unlock
    canvasElement.addEventListener('click', (event) => {
        if (isLocked) {
            isLocked = false;
        } else {
            isLocked = true;

            // Calculate target rotation based on click position
            const normalizedX = (event.clientX / window.innerWidth) * 2 - 1;
            const normalizedY = -(event.clientY / window.innerHeight) * 2 + 1;

            // Current effective rotation
            const currentRotY = globeGroup.rotation.y;
            const currentRotX = globeGroup.rotation.x;

            // Set target to be current + small offset based on mouse position
            // This ensures we don't "unwind" the rotation
            targetLockRotationY = currentRotY + (normalizedX * 0.2);
            targetLockRotationX = currentRotX + (normalizedY * 0.2);
        }
    });

    const animate = () => {
        requestAnimationFrame(animate);

        if (isLocked) {
            // Smoothly interpolate to locked position
            // Very slow lerp factor (0.02) for "heavy" feel
            globeGroup.rotation.x += (targetLockRotationX - globeGroup.rotation.x) * 0.02;
            globeGroup.rotation.y += (targetLockRotationY - globeGroup.rotation.y) * 0.02;
        } else {
            // 1. Base Rotation (Earth spins West to East)
            // Only rotate if hovering
            if (isHovering) {
                baseRotationY += 0.0002; // Very slow speed
            }

            // 2. Parallax Easing
            targetParallaxX += (mouseX - targetParallaxX) * 0.05;
            targetParallaxY += (mouseY - targetParallaxY) * 0.05;

            // 3. Apply Rotation
            // We add the parallax offset to the base rotation
            globeGroup.rotation.y = baseRotationY + targetParallaxX;
            globeGroup.rotation.x = targetParallaxY;
        }

        // Stars subtle movement (always)
        stars.rotation.y -= 0.00005;

        // Update shader view vector
        atmosphere.material.uniforms.viewVector.value = new THREE.Vector3().subVectors(camera.position, atmosphere.position);

        renderer.render(scene, camera);
    };

    animate();

    // Resize Handler
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
};

// --- Chart.js ---
const updateChart = (predictedPrice) => {
    const ctx = document.getElementById('price-chart').getContext('2d');

    // Generate dummy distribution data centered around prediction
    const dataPoints = [];
    const labels = [];
    const variance = predictedPrice * 0.2;

    for (let i = -5; i <= 5; i++) {
        const price = predictedPrice + (i * variance / 5);
        labels.push(`$${(price / 1000).toFixed(0)}k`);
        // Bell curve-ish values
        const value = Math.exp(-(Math.pow(i, 2)) / 4) * 100;
        dataPoints.push(value);
    }

    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Market Distribution',
                data: dataPoints,
                backgroundColor: dataPoints.map((val, i) => i === 5 ? '#00f2ff' : 'rgba(255, 255, 255, 0.1)'),
                borderRadius: 4,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            },
            scales: {
                y: { display: false },
                x: {
                    grid: { display: false },
                    ticks: { color: '#a0a8c0', font: { size: 10 } }
                }
            },
            animation: {
                duration: 1500,
                easing: 'easeOutQuart'
            }
        }
    });
};

// --- UI Logic ---
const formatCurrency = (num) => {
    return new Intl.NumberFormat('en-US', {
        style: 'decimal',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(num);
};

const animateValue = (obj, start, end, duration) => {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        // Ease out expo
        const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);

        const current = Math.floor(start + (end - start) * ease);
        obj.innerHTML = formatCurrency(current);

        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
};

// Form Submission
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // 1. UI State: Loading
    emptyState.classList.add('hidden');
    resultContent.classList.add('hidden');
    loadingState.classList.remove('hidden');

    // Gather data
    const formData = new FormData(form);
    const payload = {
        BathroomsFull: parseInt(formData.get('BathroomsFull')),
        BathroomsHalf: parseInt(formData.get('BathroomsHalf')),
        BedroomsTotal: parseInt(formData.get('BedroomsTotal')),
        LivingArea: parseFloat(formData.get('LivingArea'))
    };

    try {
        // 2. API Call
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Network response was not ok');

        const data = await response.json();
        const price = data.predicted_price;

        // 3. UI State: Success
        // Artificial delay for "cinematic" feel if API is too fast
        setTimeout(() => {
            loadingState.classList.add('hidden');
            resultContent.classList.remove('hidden');

            // Animate Price
            animateValue(priceValue, 0, price, 1500);

            // Update Confidence Band
            const low = price * 0.95;
            const high = price * 1.05;
            rangeLow.textContent = `$${formatCurrency(low)}`;
            rangeHigh.textContent = `$${formatCurrency(high)}`;

            // Reset then animate width
            bandFill.style.width = '0%';
            setTimeout(() => {
                bandFill.style.width = '100%'; // Represents the confidence range
            }, 100);

            // Update Summary
            // Calculate dynamic trend based on price vs average (dummy average)
            // const averagePrice = 500000; // Baseline
            // const trendValue = ((price - averagePrice) / averagePrice) * 5;
            // const trendDirection = trendValue >= 0 ? '↗' : '↘';
            // const trendColor = trendValue >= 0 ? 'var(--accent-cyan)' : '#ff4444';
            // const trendText = `${Math.abs(trendValue).toFixed(1)}% ${trendDirection}`;

            summaryList.innerHTML = `
                <li><span>Living Area</span> <span>${payload.LivingArea} sq ft</span></li>
                <li><span>Bedrooms</span> <span>${payload.BedroomsTotal}</span></li>
                <li><span>Bathrooms</span> <span>${payload.BathroomsFull + (payload.BathroomsHalf * 0.5)}</span></li>
                <li><span>Market Trend</span> <span style="color: ${trendColor}">${trendText}</span></li>
            `;

            // Update Chart
            updateChart(price);

        });

    } catch (error) {
        console.error('Error:', error);
        loadingState.innerHTML = '<p style="color: #ff4444">Error calculating prediction. Is the backend running?</p>';
    }
});

initThreeJS();
