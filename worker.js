
export default {
    async fetch(request, env) {
        const headers = {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers });
        }

        if (request.method !== 'PUT') {
            return new Response(JSON.stringify({ error: 'Chỉ hỗ trợ phương thức PUT' }), {
                status: 405,
                headers: {
                    Allow: 'PUT',
                },
            });
        }

        try {
            const url = new URL(request.url);
            const key = url.pathname.slice(1);

            const watermarkObject = await env.WATERMARK_BUCKET.get('watermark.png');
            if (!watermarkObject) {
                throw new Error('Watermark không tìm thấy trong WATERMARK_BUCKET');
            }
            const watermarkUrl = `https://pub-${env.CLOUDFLARE_ACCOUNT_ID}.r2.dev/watermark-bucket/watermark.png`;

            const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
            const deliveryAccountId = process.env.CLOUDFLARE_DELIVERY_ACCOUNT_ID;
            const apiToken = process.env.CLOUDFLARE_API_TOKEN;

            const uploadFormData = new FormData();
            uploadFormData.append('file', request.body); // Sử dụng body từ PUT request
            uploadFormData.append('metadata', JSON.stringify({
                type: 'product',
                draw: [
                    {
                        url: watermarkUrl,
                        opacity: 0.5,
                        width: 576, // 1920 * 0.3
                        x: 10,
                        y: 10,
                    },
                ],
            }));
            uploadFormData.append('requireSignedURLs', 'false');

            const imageResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiToken}`,
                },
                body: uploadFormData,
            });

            const imageResult = await imageResponse.json();
            if (!imageResult.success) {
                throw new Error(`Upload thất bại: ${imageResult.errors[0].message}`);
            }

            const imageId = imageResult.result.id;
            const fullUrl = `https://imagedelivery.net/${deliveryAccountId}/${imageId}/productfull`;
            const thumbUrl = `https://imagedelivery.net/${deliveryAccountId}/${imageId}/productthumb`;

            return new Response(JSON.stringify({
                message: 'Upload thành công',
                fileName: key,
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
