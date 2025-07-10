export default {
    async fetch(request) {
        const headers = {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers });
        }

        if (request.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Phương thức không được hỗ trợ' }), {
                status: 405,
                headers,
            });
        }

        try {
            // Lấy biến môi trường
            const accountId = env.CLOUDFLARE_ACCOUNT_ID;
            const deliveryAccountId = env.CLOUDFLARE_DELIVERY_ACCOUNT_ID;
            const apiToken = env.CLOUDFLARE_API_TOKEN;

            // Kiểm tra biến môi trường
            if (!accountId || !deliveryAccountId || !apiToken) {
                throw new Error('Một hoặc nhiều biến môi trường không được định nghĩa');
            }

            const formData = await request.formData();
            const image = formData.get('image');
            const type = formData.get('type');

            console.log('FormData keys:', [...formData.keys()]);
            console.log('Image:', image ? image.name : 'No image');
            console.log('Type:', type);

            if (!image || !type) {
                return new Response(JSON.stringify({ error: 'Thiếu file ảnh hoặc type' }), {
                    status: 400,
                    headers,
                });
            }

            const config = {
                cloudflare: {
                    account_id: accountId,
                    delivery_account_id: deliveryAccountId,
                    api_token: apiToken,
                },
                image_types: {
                    product: {
                        full_size: { width: 1920, height: 1080, fit: 'cover' },
                        thumb_size: { width: 300, height: 300, fit: 'cover' },
                    },
                },
                watermark: {
                    url: 'https://test-togihome.c79802e0b589c59dfc480b8b687fda90.r2.cloudflarestorage.com/togihome-watermark-origin.png',
                    opacity: 0.5,
                    scale: 0.3,
                    position: { x: 10, y: 10 },
                },
            };

            // Tạo metadata cho watermark và resize
            const metadata = {
                type,
                draw: [
                    {
                        url: config.watermark.url,
                        opacity: config.watermark.opacity,
                        width: Math.round(config.image_types[type].full_size.width * config.watermark.scale),
                        x: config.watermark.position.x,
                        y: config.watermark.position.y,
                    },
                ],
            };

            // Tải ảnh lên Cloudflare Images
            const { fullUrl, thumbUrl, imageId } = await uploadToCloudflareImages(image, config, metadata, type);

            return new Response(JSON.stringify({
                message: 'Upload thành công',
                fileName: image.name,
                type,
                fullUrl,
                thumbUrl,
                imageId,
            }), {
                status: 200,
                headers,
            });
        } catch (error) {
            console.error('Error:', error.message);
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers,
            });
        }
    },
};

async function uploadToCloudflareImages(image, config, metadata, type) {
    const uploadUrl = `https://api.cloudflare.com/client/v4/accounts/${config.cloudflare.account_id}/images/v1`;
    const formData = new FormData();
    formData.append('file', image);
    formData.append('metadata', JSON.stringify(metadata));
    formData.append('variants', 'productfull,productthumb');

    const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.cloudflare.api_token}` },
        body: formData,
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
