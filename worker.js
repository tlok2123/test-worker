const sharp = require('sharp');

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Phương thức không được hỗ trợ' }), {
            status: 405,
            headers
        });
    }

    try {
        const formData = await request.formData();
        const file = formData.get('image');
        const type = formData.get('type');

        if (!file || !type) {
            return new Response(JSON.stringify({ error: 'Thiếu file ảnh hoặc type' }), {
                status: 400,
                headers
            });
        }

        const config = {
            cloudflare: {
                account_id: CLOUDFLARE_ACCOUNT_ID, // Lấy từ biến môi trường
                delivery_account_id: CLOUDFLARE_DELIVERY_ACCOUNT_ID,
                api_token: CLOUDFLARE_API_TOKEN
            },
            image_types: {
                product: {
                    full_size: [1920, 1080],
                    thumb_size: [300, 300],
                    crop: true
                }
            },
            watermark: {
                url: "https://test-togihome.c79802e0b589c59dfc480b8b687fda90.r2.cloudflarestorage.com/togihome-watermark-origin.png",
                opacity: 0.5,
                scale: 0.3,
                position: { left: 10, top: 10 }
            }
        };

        // Tải ảnh gốc
        const imageBuffer = await file.arrayBuffer();

        // Tải watermark
        const watermarkResponse = await fetch(config.watermark.url);
        if (!watermarkResponse.ok) {
            throw new Error(`Không thể tải watermark: ${watermarkResponse.statusText}`);
        }
        const watermarkBuffer = await watermarkResponse.arrayBuffer();

        // Xử lý ảnh: nén, resize, và chèn watermark
        const processedImage = await processImage(imageBuffer, watermarkBuffer, config, type);

        // Tải ảnh lên Cloudflare Images
        const { fullUrl, thumbUrl, imageId } = await uploadToCloudflareImages(processedImage, config, type, file.name);

        return new Response(JSON.stringify({
            message: 'Upload thành công',
            fileName: file.name,
            type,
            fullUrl,
            thumbUrl,
            imageId
        }), {
            status: 200,
            headers
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers
        });
    }
}

async function processImage(imageBuffer, watermarkBuffer, config, type) {
    const imageConfig = config.image_types[type];
    if (!imageConfig) {
        throw new Error(`Loại ảnh không hợp lệ: ${type}`);
    }

    const { full_size, thumb_size, crop } = imageConfig;

    // Resize watermark theo tỉ lệ
    const watermark = await sharp(watermarkBuffer)
        .resize({ width: Math.round(full_size[0] * config.watermark.scale) })
        .toBuffer();

    // Xử lý ảnh chính
    return sharp(imageBuffer)
        .resize({
            width: full_size[0],
            height: full_size[1],
            fit: crop ? 'cover' : 'contain'
        })
        .composite([{
            input: watermark,
            left: config.watermark.position.left,
            top: config.watermark.position.top,
            blend: 'over',
            opacity: config.watermark.opacity
        }])
        .jpeg({ quality: 80 }) // Nén ảnh với chất lượng 80%
        .toBuffer();
}

async function uploadToCloudflareImages(imageBuffer, config, type, fileName) {
    const uploadUrl = `https://api.cloudflare.com/client/v4/accounts/${config.cloudflare.account_id}/images/v1`;
    const formData = new FormData();
    formData.append('file', new Blob([imageBuffer], { type: 'image/jpeg' }));
    formData.append('metadata', JSON.stringify({ type }));

    const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.cloudflare.api_token}` },
        body: formData
    });

    const result = await response.json();
    if (!result.success) {
        throw new Error(`Upload thất bại: ${result.errors[0].message}`);
    }

    const imageId = result.result.id;
    const fullUrl = `https://imagedelivery.net/${config.cloudflare.delivery_account_id}/${imageId}/productfull`;
    const thumbUrl = `https://imagedelivery.net/${config.cloudflare.delivery_account_id}/${imageId}/productthumb`;

    return { fullUrl, thumbUrl, imageId };
}