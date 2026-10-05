(function(){
    const API_MODE = 'mock';
    const MOCK_RESPONSE = {
        recommendedCrop: 'Cotton',
        confidence: 87,
        soil: { nitrogen: 'Low', phosphorus: 'Low', potassium: 'High', ph: 'High' },
        climate: { rainfall: 'Low' },
        recommendations: [
            'Consider appropriate nitrogen management.',
            'Consider appropriate phosphorus management.',
            'Monitor soil moisture because rainfall is low.',
            'Consider crop-specific soil management for the submitted pH.'
        ]
    };
    async function predictCrop(payload){
        if(API_MODE === 'api'){
            const response = await fetch('/api/ai/crop-prediction', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
            if(!response.ok) throw new Error('Crop analysis service returned an error ('+response.status+').');
            return response.json();
        }
        await new Promise(resolve=>setTimeout(resolve,650));
        return JSON.parse(JSON.stringify(MOCK_RESPONSE));
    }
    window.HumusIQCropApi = { predictCrop };
})();
