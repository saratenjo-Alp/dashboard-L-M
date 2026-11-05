// Initialize Lucide icons
lucide.createIcons();

const safeStorage = {
    getItem: (key) => { try { return localStorage.getItem(key); } catch (e) { return null; } },
    setItem: (key, val) => { try { localStorage.setItem(key, val); } catch (e) {} },
    removeItem: (key) => { try { localStorage.removeItem(key); } catch (e) {} }
};

let currentFilters = {
    responsable: null,
    motivo: null,
    placa: null,
    cliente: null,
    resp_pago: null,
    fechaInicio: safeStorage.getItem('fechaInicio') || null,
    fechaFin: safeStorage.getItem('fechaFin') || null
};

let rawRechazos = [];
let initialKpis = {};
let baseTrendData = [];

// Chart Instances
let gaugeCumplimientoChart, gaugeRechazoChart, trendChart, motivoChart, responsableChart, placaChart, clienteChart, responsablePagoChart;

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof dashboardDataB64 === 'undefined') {
        console.error('Data not loaded. Ensure data.js is included.');
        return;
    }

    // Decompress data
    const binaryString = atob(dashboardDataB64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const response = new Response(stream);
    const text = await response.text();
    const dashboardData = JSON.parse(text);

    rawRechazos = dashboardData.rechazos_raw || [];
    initialKpis = dashboardData.kpis || {};
    baseTrendData = [...dashboardData.trend_data].sort((a,b) => a.fecha.localeCompare(b.fecha));

    if (baseTrendData.length > 0 && !currentFilters.fechaInicio && !currentFilters.fechaFin) {
        const lastDate = baseTrendData[baseTrendData.length - 1].fecha;
        const lastMonth = lastDate.substring(0, 7);
        currentFilters.fechaInicio = lastMonth + "-01";
        currentFilters.fechaFin = lastDate;
    }

    Chart.register(ChartDataLabels);

    // Theme logic
    const themeBtn = document.getElementById('themeToggleBtn');
    let currentTheme = localStorage.getItem('theme') || 'dark';
    
    const applyTheme = (theme) => {
        document.body.setAttribute('data-theme', theme);
        themeBtn.innerHTML = theme === 'dark' ? '<i data-lucide="sun"></i>' : '<i data-lucide="moon"></i>';
        lucide.createIcons();
        localStorage.setItem('theme', theme);
        if (typeof updateChartTheme === 'function') updateChartTheme();
    };

    themeBtn.addEventListener('click', () => {
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
        applyTheme(currentTheme);
    });

    // Initial render
    initCharts();
    updateDashboard();
    applyTheme(currentTheme);

    // Date Range logic
    const dateStart = document.getElementById('dateStart');
    const dateEnd = document.getElementById('dateEnd');
    
    if (dateStart && dateEnd) {
        if (currentFilters.fechaInicio) dateStart.value = currentFilters.fechaInicio;
        if (currentFilters.fechaFin) dateEnd.value = currentFilters.fechaFin;

        const updateDateRange = () => {
            currentFilters.fechaInicio = dateStart.value || null;
            currentFilters.fechaFin = dateEnd.value || null;
            if (currentFilters.fechaInicio) safeStorage.setItem('fechaInicio', currentFilters.fechaInicio);
            else safeStorage.removeItem('fechaInicio');
            if (currentFilters.fechaFin) safeStorage.setItem('fechaFin', currentFilters.fechaFin);
            else safeStorage.removeItem('fechaFin');
            updateDashboard();
        };
        dateStart.addEventListener('change', updateDateRange);
        dateEnd.addEventListener('change', updateDateRange);
    }

    document.getElementById('clearFiltersBtn').addEventListener('click', () => {
        currentFilters = { responsable: null, motivo: null, placa: null, cliente: null, resp_pago: null, fechaInicio: null, fechaFin: null };
        safeStorage.removeItem('fechaInicio');
        safeStorage.removeItem('fechaFin');
        if (dateStart) dateStart.value = '';
        if (dateEnd) dateEnd.value = '';
        updateDashboard();
    });

    // Sidebar Sliding Indicator with Intersection Observer
    // Sidebar Sliding Indicator & ScrollSpy
    const navItems = Array.from(document.querySelectorAll('.nav-item'));
    const navIndicator = document.querySelector('.nav-indicator');
    const navMenu = document.querySelector('.nav-menu');
    const sections = ['overview', 'ventas', 'rechazos', 'reportes'].map(id => document.getElementById(id)).filter(Boolean);

    const updateIndicator = (activeItem) => {
        if (!navIndicator || !activeItem || !navMenu) return;
        const menuRect = navMenu.getBoundingClientRect();
        const itemRect = activeItem.getBoundingClientRect();
        navIndicator.style.top = `${itemRect.top - menuRect.top}px`;
        navIndicator.style.height = `${itemRect.height}px`;
    };

    const syncScroll = () => {
        let currentId = sections[0]?.id;
        sections.forEach(sec => {
            const rect = sec.getBoundingClientRect();
            // Si el elemento cruzó el tercio superior de la pantalla
            if (rect.top <= window.innerHeight / 3) {
                currentId = sec.id;
            }
        });

        const activeNav = navItems.find(nav => nav.getAttribute('href') === `#${currentId}`);
        if (activeNav && !activeNav.classList.contains('active')) {
            navItems.forEach(nav => nav.classList.remove('active'));
            activeNav.classList.add('active');
            updateIndicator(activeNav);
        }
    };

    window.addEventListener('scroll', syncScroll, { passive: true });

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            navItems.forEach(nav => nav.classList.remove('active'));
            e.currentTarget.classList.add('active');
            updateIndicator(e.currentTarget);
        });
    });

    // Initial positioning
    setTimeout(() => {
        syncScroll();
        const activeNav = document.querySelector('.nav-item.active');
        if (activeNav) updateIndicator(activeNav);
    }, 150);
});

const formatCurrency = (value) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
const formatNumber = (value) => new Intl.NumberFormat('es-CO').format(value);
const formatMillions = (value) => {
    if (value >= 1e9) return (value / 1e9).toFixed(1) + ' bill.';
    if (value >= 1e6) return (value / 1e6).toFixed(1) + ' mill.';
    if (value >= 1e3) return (value / 1e3).toFixed(1) + ' mil';
    return formatNumber(value);
};

function toggleFilter(type, value) {
    if (type === 'fecha') {
        if (currentFilters.fechaInicio === value && currentFilters.fechaFin === value) {
            currentFilters.fechaInicio = null;
            currentFilters.fechaFin = null;
            safeStorage.removeItem('fechaInicio');
            safeStorage.removeItem('fechaFin');
        } else {
            currentFilters.fechaInicio = value;
            currentFilters.fechaFin = value;
            safeStorage.setItem('fechaInicio', value);
            safeStorage.setItem('fechaFin', value);
        }
        const dateStart = document.getElementById('dateStart');
        const dateEnd = document.getElementById('dateEnd');
        if (dateStart) dateStart.value = currentFilters.fechaInicio || '';
        if (dateEnd) dateEnd.value = currentFilters.fechaFin || '';
    } else {
        if (currentFilters[type] === value) {
            currentFilters[type] = null; // deselect
        } else {
            currentFilters[type] = value;
        }
    }
    updateDashboard();
}

function getFilteredData() {
    return rawRechazos.filter(r => {
        if (currentFilters.responsable && r.responsable !== currentFilters.responsable) return false;
        if (currentFilters.motivo && r.motivo !== currentFilters.motivo) return false;
        if (currentFilters.placa && r.placa !== currentFilters.placa) return false;
        if (currentFilters.cliente && r.cliente !== currentFilters.cliente) return false;
        if (currentFilters.resp_pago && r.resp_pago !== currentFilters.resp_pago) return false;
        if (currentFilters.fechaInicio && r.fecha < currentFilters.fechaInicio) return false;
        if (currentFilters.fechaFin && r.fecha > currentFilters.fechaFin) return false;
        return true;
    });
}

function aggregateData(filtered) {
    let total_rechazo_val = 0;
    let respMap = {};
    let motMap = {};
    let motRespMap = {};
    let placaMap = {};
    let trendMap = {};
    let clienteMap = {};
    let clienteUnitsMap = {};
    let respPagoMap = {};
    let totales = new Set();
    let parciales = new Set();

    filtered.forEach(r => {
        total_rechazo_val += r.valor;
        if (r.factura) {
            if (r.tipo.includes('TOTAL')) totales.add(r.factura);
            if (r.tipo.includes('PARCIAL')) parciales.add(r.factura);
        }
        respMap[r.responsable] = (respMap[r.responsable] || 0) + r.valor;
        motMap[r.motivo] = (motMap[r.motivo] || 0) + r.valor;
        if (!motRespMap[r.motivo]) motRespMap[r.motivo] = r.responsable;
        if (r.placa && r.placa.toString().toLowerCase() !== 'nan') placaMap[r.placa] = (placaMap[r.placa] || 0) + r.valor;
        if (r.fecha) trendMap[r.fecha] = (trendMap[r.fecha] || 0) + r.valor;
        if (r.cliente) {
            clienteMap[r.cliente] = (clienteMap[r.cliente] || 0) + r.valor;
            clienteUnitsMap[r.cliente] = (clienteUnitsMap[r.cliente] || 0) + (r.units || 0);
        }
        if (r.resp_pago) respPagoMap[r.resp_pago] = (respPagoMap[r.resp_pago] || 0) + r.valor;
    });

    const total_pedidos = initialKpis.total_pedidos || 0; 
    const rechazos_totales = totales.size;
    const rechazos_parciales = parciales.size;
    const pedidos_rechazados = rechazos_totales + rechazos_parciales;
    const pedidos_entregados = Math.max(0, total_pedidos - pedidos_rechazados);
    const cumplimiento_pedidos = total_pedidos > 0 ? (pedidos_entregados / total_pedidos * 100) : 0;
    const rechazo_pedidos_pct = total_pedidos > 0 ? (pedidos_rechazados / total_pedidos * 100) : 0;

    const byResponsable = Object.keys(respMap).map(k => ({name: k, value: respMap[k]})).sort((a,b) => b.value - a.value);
    const byMotivo = Object.keys(motMap).map(k => ({name: k, value: motMap[k], responsable: motRespMap[k]})).sort((a,b) => b.value - a.value).slice(0, 20);
    const byPlaca = Object.keys(placaMap).map(k => ({name: k, value: placaMap[k]})).sort((a,b) => b.value - a.value).slice(0, 15);
    const byCliente = Object.keys(clienteMap).map(k => ({name: k, value: clienteMap[k], units: clienteUnitsMap[k]})).sort((a,b) => b.value - a.value).slice(0, 10);
    const byRespPago = Object.keys(respPagoMap).map(k => ({name: k, value: respPagoMap[k]})).sort((a,b) => b.value - a.value).slice(0, 10);
    
    let trendFiltered = baseTrendData.filter(d => {
        if (currentFilters.fechaInicio && d.fecha < currentFilters.fechaInicio) return false;
        if (currentFilters.fechaFin && d.fecha > currentFilters.fechaFin) return false;
        return true;
    }).map(d => ({
        fecha: d.fecha,
        venta: d.venta,
        rechazo: trendMap[d.fecha] || 0
    }));

    let dynamicVentaBruta = 0;
    trendFiltered.forEach(d => { dynamicVentaBruta += d.venta; });
    const ratio_rechazo_val = dynamicVentaBruta > 0 ? (total_rechazo_val / dynamicVentaBruta * 100) : 0;

    return {
        total_rechazo_val, ratio_rechazo_val, pedidos_entregados, dynamicVentaBruta,
        rechazos_totales, rechazos_parciales, cumplimiento_pedidos, rechazo_pedidos_pct,
        byResponsable, byMotivo, byPlaca, byCliente, byRespPago, trendFiltered
    };
}

function initCharts() {
    const chartOptions = {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
            x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
            y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
        }
    };

    // Gauges
    const createGauge = (canvasId) => {
        const ctx = document.getElementById(canvasId).getContext('2d');
        return new Chart(ctx, {
            type: 'doughnut',
            data: { datasets: [{ data: [0, 100], backgroundColor: ['#3b82f6', 'rgba(255,255,255,0.08)'], borderWidth: 0 }] },
            options: {
                responsive: true, maintainAspectRatio: false, rotation: -90, circumference: 180, cutout: '78%',
                animation: { duration: 800 },
                plugins: { tooltip: { enabled: false }, datalabels: { display: false } }
            }
        });
    };
    gaugeCumplimientoChart = createGauge('gaugeCumplimiento');
    gaugeRechazoChart = createGauge('gaugeRechazo');
    gaugeRechazoChart.data.datasets[0].backgroundColor[0] = '#ef4444';

    // Trend Chart
    trendChart = new Chart(document.getElementById('trendChart').getContext('2d'), {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: {
            ...chartOptions,
            onClick: (e, elements) => {
                if(elements[0]) toggleFilter('fecha', trendChart.data.labels[elements[0].index]);
            },
            onHover: (e, el) => e.native.target.style.cursor = el[0] ? 'pointer' : 'default'
        }
    });

    // Motivo Chart
    motivoChart = new Chart(document.getElementById('motivoChart').getContext('2d'), {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
            ...chartOptions, indexAxis: 'y', layout: { padding: { right: 180 } },
            onClick: (e, elements) => {
                if(elements[0]) toggleFilter('motivo', motivoChart.data.labels[elements[0].index]);
            },
            onHover: (e, el) => e.native.target.style.cursor = el[0] ? 'pointer' : 'default',
            plugins: {
                legend: { display: false },
                datalabels: { color: '#64748b', font: { weight: 'bold', size: 12 }, anchor: 'end', align: 'end', offset: 4, clip: false }
            },
            scales: { x: { display: false }, y: { ticks: { color: '#94a3b8' }, grid: { display: false } } }
        }
    });

    // Responsable Chart
    responsableChart = new Chart(document.getElementById('responsableChart').getContext('2d'), {
        type: 'doughnut',
        data: { labels: [], datasets: [] },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '78%', layout: { padding: { left: 20, right: 20, top: 0, bottom: 0 } },
            onClick: (e, elements) => {
                if(elements[0]) toggleFilter('responsable', responsableChart.data.labels[elements[0].index]);
            },
            onHover: (e, el) => e.native.target.style.cursor = el[0] ? 'pointer' : 'default',
            plugins: {
                legend: { position: 'right', labels: { color: '#94a3b8', padding: 10 } },
                datalabels: { color: '#ffffff', font: { weight: 'bold', size: 12 } }
            }
        }
    });

    // Placa Chart
    placaChart = new Chart(document.getElementById('placaChart').getContext('2d'), {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
            responsive: true, maintainAspectRatio: false, indexAxis: 'y', layout: { padding: { right: 180 } },
            onClick: (e, elements) => {
                if(elements[0]) toggleFilter('placa', placaChart.data.labels[elements[0].index]);
            },
            onHover: (e, el) => e.native.target.style.cursor = el[0] ? 'pointer' : 'default',
            plugins: {
                legend: { display: false },
                datalabels: { color: '#64748b', font: { weight: 'bold', size: 11 }, anchor: 'end', align: 'end', offset: 4, clip: false }
            },
            scales: { x: { display: false }, y: { ticks: { color: '#60a5fa', font: { weight: '700', size: 12 } }, grid: { display: false }, border: { display: false } } }
        }
    });

    // Cliente Chart
    clienteChart = new Chart(document.getElementById('clienteChart').getContext('2d'), {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
            responsive: true, maintainAspectRatio: false, indexAxis: 'y', layout: { padding: { right: 220 } },
            onClick: (e, elements) => {
                if(elements[0]) toggleFilter('cliente', clienteChart.data.labels[elements[0].index]);
            },
            onHover: (e, el) => e.native.target.style.cursor = el[0] ? 'pointer' : 'default',
            plugins: {
                legend: { display: false },
                datalabels: { color: '#64748b', font: { weight: 'bold', size: 11 }, anchor: 'end', align: 'end', offset: 4, clip: false }
            },
            scales: { x: { display: false }, y: { ticks: { color: '#60a5fa', font: { weight: '700', size: 12 } }, grid: { display: false }, border: { display: false } } }
        }
    });

    // Responsable Pago Chart
    responsablePagoChart = new Chart(document.getElementById('responsablePagoChart').getContext('2d'), {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
            responsive: true, maintainAspectRatio: false, indexAxis: 'y', layout: { padding: { right: 180 } },
            onClick: (e, elements) => {
                if(elements[0]) toggleFilter('resp_pago', responsablePagoChart.data.labels[elements[0].index]);
            },
            onHover: (e, el) => e.native.target.style.cursor = el[0] ? 'pointer' : 'default',
            plugins: {
                legend: { display: false },
                datalabels: { color: '#64748b', font: { weight: 'bold', size: 11 }, anchor: 'end', align: 'end', offset: 4, clip: false }
            },
            scales: { x: { display: false }, y: { ticks: { color: '#60a5fa', font: { weight: '700', size: 12 } }, grid: { display: false }, border: { display: false } } }
        }
    });

    // Añadir soporte nativo para clics en las etiquetas del eje Y (izquierdo)
    function addNativeLabelClick(chartId, chartInstance, filterKey) {
        const canvas = document.getElementById(chartId);
        
        canvas.addEventListener('click', (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            if (chartInstance.chartArea && x <= chartInstance.chartArea.left) {
                const yAxis = chartInstance.scales.y;
                if (y >= yAxis.top && y <= yAxis.bottom) {
                    let idx = -1;
                    if (typeof yAxis.getValueForPixel === 'function') {
                        idx = yAxis.getValueForPixel(y);
                    } else {
                        const rowHeight = (yAxis.bottom - yAxis.top) / Math.max(1, chartInstance.data.labels.length);
                        idx = Math.floor((y - yAxis.top) / rowHeight);
                    }
                    if (idx >= 0 && idx < chartInstance.data.labels.length) {
                        toggleFilter(filterKey, chartInstance.data.labels[idx]);
                    }
                }
            }
        });

        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            if (chartInstance.chartArea && x <= chartInstance.chartArea.left) {
                const yAxis = chartInstance.scales.y;
                if (y >= yAxis.top && y <= yAxis.bottom) {
                    canvas.style.cursor = 'pointer';
                    return;
                }
            }
            // Let ChartJS hover handle the rest, but we reset if needed
            // Actually ChartJS will override this immediately for the chart area.
        });
    }

    addNativeLabelClick('motivoChart', motivoChart, 'motivo');
    addNativeLabelClick('placaChart', placaChart, 'placa');
    addNativeLabelClick('clienteChart', clienteChart, 'cliente');
    addNativeLabelClick('responsablePagoChart', responsablePagoChart, 'resp_pago');
}

function updateDashboard() {
    const hasFilters = Object.values(currentFilters).some(v => v !== null);
    const clearBtn = document.getElementById('clearFiltersBtn');
    if (hasFilters) {
        clearBtn.style.opacity = '1';
        clearBtn.style.cursor = 'pointer';
    } else {
        clearBtn.style.opacity = '0.5';
        clearBtn.style.cursor = 'not-allowed';
    }

    const filtered = getFilteredData();
    const agg = aggregateData(filtered);

    // Animation helper for numbers
    const animateKpi = (id, newValue, formatFn) => {
        const el = document.getElementById(id);
        const startValue = parseFloat(el.getAttribute('data-raw')) || 0;
        el.setAttribute('data-raw', newValue);
        
        let startTimestamp = null;
        const duration = 800; // match chart animation
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            const current = startValue + progress * (newValue - startValue);
            el.innerHTML = formatFn(current);
            if (progress < 1) window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
    };

    // Update KPIs with animation
    animateKpi('kpi-venta-bruta', agg.dynamicVentaBruta, formatCurrency);
    animateKpi('kpi-total-pedidos', initialKpis.total_pedidos, formatNumber);
    animateKpi('kpi-ratio', agg.ratio_rechazo_val, v => v.toFixed(2) + ' %');
    animateKpi('kpi-rechazo-val', agg.total_rechazo_val, formatCurrency);
    animateKpi('kpi-entregados', agg.pedidos_entregados, formatNumber);
    animateKpi('kpi-rechazos-total', agg.rechazos_totales, formatNumber);
    animateKpi('kpi-rechazos-parciales', agg.rechazos_parciales, formatNumber);

    // Update Gauges with animation
    animateKpi('gauge-cumplimiento-val', agg.cumplimiento_pedidos, v => v.toFixed(1) + ' %');
    gaugeCumplimientoChart.data.datasets[0].data = [agg.cumplimiento_pedidos, 100 - agg.cumplimiento_pedidos];
    gaugeCumplimientoChart.update();

    animateKpi('gauge-rechazo-val', agg.rechazo_pedidos_pct, v => v.toFixed(1) + ' %');
    gaugeRechazoChart.data.datasets[0].data = [agg.rechazo_pedidos_pct, 100 - agg.rechazo_pedidos_pct];
    gaugeRechazoChart.update();

    let finalTrendData = agg.trendFiltered;

    // Update Trend
    trendChart.data.labels = finalTrendData.map(d => d.fecha);
    trendChart.data.datasets = [
        {
            label: 'Venta Bruta ($)', data: finalTrendData.map(d => d.venta),
            borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderWidth: 2, tension: 0.4, fill: true, datalabels: { display: false },
            pointRadius: 3
        },
        {
            label: 'Rechazos ($)', data: finalTrendData.map(d => d.rechazo),
            borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderWidth: 2, tension: 0.4, fill: true,
            pointRadius: 3,
            pointBackgroundColor: '#ef4444',
            datalabels: {
                display: (context) => context.chart.data.labels.length <= 15,
                color: '#ff8a8a',
                formatter: (value, context) => {
                    const venta = finalTrendData[context.dataIndex].venta;
                    return venta > 0 ? ((value / venta) * 100).toFixed(1) + '%' : '0%';
                }
            }
        }
    ];
    trendChart.update();

    // Update Motivo
    motivoChart.data.labels = agg.byMotivo.map(d => d.name);
    motivoChart.data.datasets = [{
        label: 'Rechazo ($)', data: agg.byMotivo.map(d => d.value),
        backgroundColor: agg.byMotivo.map(d => {
            if(currentFilters.motivo && d.name !== currentFilters.motivo) return 'rgba(148,163,184,0.3)';
            if (d.responsable === 'LOGISTICA') return '#3b82f6';
            if (d.responsable === 'COMERCIAL' || d.responsable === 'VENTAS') return '#ef4444';
            return '#3b82f6';
        }),
        borderRadius: 4
    }];
    motivoChart.options.plugins.datalabels.formatter = (value) => {
        const pct = agg.total_rechazo_val > 0 ? ((value / agg.total_rechazo_val) * 100).toFixed(1) + '%' : '0%';
        return formatMillions(value) + ' | ' + pct;
    };
    motivoChart.update();

    // Update Responsable
    responsableChart.data.labels = agg.byResponsable.map(d => d.name);
    responsableChart.data.datasets = [{
        data: agg.byResponsable.map(d => d.value),
        backgroundColor: agg.byResponsable.map(d => {
            const isSelected = currentFilters.responsable === d.name;
            const anySelected = currentFilters.responsable !== null;
            if (anySelected && !isSelected) return 'rgba(148,163,184,0.2)';
            if (d.name === 'LOGISTICA') return '#3b82f6';
            if (d.name === 'VENTAS' || d.name === 'COMERCIAL') return '#ef4444';
            return '#3b82f6';
        }),
        borderWidth: 0
    }];
    responsableChart.options.plugins.datalabels.formatter = (value) => {
        return agg.total_rechazo_val > 0 ? ((value / agg.total_rechazo_val) * 100).toFixed(1) + '%' : '0%';
    };
    responsableChart.update();

    // Update Placa
    placaChart.data.labels = agg.byPlaca.map(d => d.name);
    placaChart.data.datasets = [{
        label: 'Rechazo ($)', data: agg.byPlaca.map(d => d.value),
        backgroundColor: agg.byPlaca.map(d => {
            if(currentFilters.placa && d.name !== currentFilters.placa) return 'rgba(148,163,184,0.3)';
            return '#3b82f6'; // blue
        }),
        borderRadius: 4
    }];
    placaChart.options.plugins.datalabels.formatter = (value) => {
        const pct = agg.total_rechazo_val > 0 ? ((value / agg.total_rechazo_val) * 100).toFixed(1) + '%' : '0%';
        return formatMillions(value) + ' | ' + pct;
    };
    placaChart.update();

    // Update Cliente
    clienteChart.data.labels = agg.byCliente.map(d => d.name);
    clienteChart.data.datasets = [{
        label: 'Rechazo ($)', data: agg.byCliente.map(d => d.value),
        backgroundColor: agg.byCliente.map(d => {
            if(currentFilters.cliente && d.name !== currentFilters.cliente) return 'rgba(148,163,184,0.3)';
            return '#ef4444'; // red
        }),
        borderRadius: 4
    }];

    clienteChart.options.plugins.datalabels.formatter = (value, context) => {
        const pct = agg.total_rechazo_val > 0 ? ((value / agg.total_rechazo_val) * 100).toFixed(1) + '%' : '0%';
        const units = agg.byCliente[context.dataIndex].units || 0;
        return `${Math.round(units)} und | ` + formatMillions(value) + ' | ' + pct;
    };
    clienteChart.update();

    // Update Responsable Pago
    responsablePagoChart.data.labels = agg.byRespPago.map(d => d.name);
    responsablePagoChart.data.datasets = [{
        label: 'Rechazo ($)', data: agg.byRespPago.map(d => d.value),
        backgroundColor: agg.byRespPago.map(d => {
            if(currentFilters.resp_pago && d.name !== currentFilters.resp_pago) return 'rgba(148,163,184,0.3)';
            return '#3b82f6'; // blue
        }),
        borderRadius: 4
    }];
    responsablePagoChart.options.plugins.datalabels.formatter = (value) => {
        const pct = agg.total_rechazo_val > 0 ? ((value / agg.total_rechazo_val) * 100).toFixed(1) + '%' : '0%';
        return formatMillions(value) + ' | ' + pct;
    };
    responsablePagoChart.update();
}

function updateChartTheme() {
    const isLight = document.body.getAttribute('data-theme') === 'light';
    const textColor = isLight ? '#475569' : '#94a3b8';
    const dataLabelColor = isLight ? '#0f172a' : '#ffffff';
    const gridColor = isLight ? 'rgba(15, 23, 42, 0.05)' : 'rgba(255, 255, 255, 0.05)';
    const gaugeBgColor = isLight ? 'rgba(148, 163, 184, 0.25)' : 'rgba(255, 255, 255, 0.08)';

    if (gaugeCumplimientoChart) {
        gaugeCumplimientoChart.data.datasets[0].backgroundColor[1] = gaugeBgColor;
        gaugeCumplimientoChart.update();
    }
    if (gaugeRechazoChart) {
        gaugeRechazoChart.data.datasets[0].backgroundColor[1] = gaugeBgColor;
        gaugeRechazoChart.update();
    }

    const charts = [trendChart, motivoChart, placaChart];
    charts.forEach(chart => {
        if (!chart) return;
        if (chart.options.plugins?.legend?.labels) {
            chart.options.plugins.legend.labels.color = textColor;
        }
        if (chart !== trendChart && chart.options.plugins?.datalabels) {
            chart.options.plugins.datalabels.color = dataLabelColor;
        }
        if (chart.options.scales?.x) {
            if (chart.options.scales.x.ticks) chart.options.scales.x.ticks.color = textColor;
            if (chart.options.scales.x.grid) chart.options.scales.x.grid.color = gridColor;
        }
        if (chart.options.scales?.y) {
            if (chart.options.scales.y.ticks) chart.options.scales.y.ticks.color = textColor;
            if (chart.options.scales.y.grid) chart.options.scales.y.grid.color = gridColor;
        }
        chart.update();
    });

    if (responsableChart) {
        if (responsableChart.options.plugins?.legend?.labels) {
            responsableChart.options.plugins.legend.labels.color = textColor;
        }
        if (responsableChart.options.plugins?.datalabels) {
            responsableChart.options.plugins.datalabels.color = dataLabelColor;
        }
        responsableChart.update();
    }
}