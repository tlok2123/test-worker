
export default {
    async fetch(request) {
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
                    account_id: CLOUDFLARE_ACCOUNT_ID,
                    delivery_account_id: CLOUDFLARE_DELIVERY_ACCOUNT_ID,
                    api_token: CLOUDFLARE_API_TOKEN
                },
                image_types: {
                    product: {
                        full_size: { width: 1920, height: 1080, fit: 'cover' },
                        thumb_size: { width: 300, height: 300, fit: 'cover' }
                    }
                },
                watermark: {
                    url: 'https://test-togihome.c79802e0b589c59dfc480b8b687fda90.r2.cloudflarestorage.com/togihome-watermark-origin.png',
                    opacity: 0.5,
                    scale: 0.3,
                    position: { x: 10, y: 10 } // Cloudflare Images sử dụng x, y thay vì left, top
                }
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
                        y: config.watermark.position.y
                    }
                ]
            };

            // Tải ảnh lên Cloudflare Images
            const { fullUrl, thumbUrl, imageId } = await uploadToCloudflareImages(file, config, metadata, type);

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
};

async function uploadToCloudflareImages(file, config, metadata, type) {
    const uploadUrl = `https://api.cloudflare.com/client/v4/accounts/${config.cloudflare.account_id}/images/v1`;
    const formData = new FormData();
    formData.append('file', file); // Tải file gốc
    formData.append('metadata', JSON.stringify(metadata));
    // Chỉ định các biến thể (variants) khi tải lên
    formData.append('variants', 'productfull,productthumb');

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
