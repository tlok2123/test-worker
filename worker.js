export default {
    async fetch(request, env) {
        const headers = {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        // Xử lý yêu cầu OPTIONS
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers });
        }

        // Kiểm tra phương thức POST
        if (request.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Chỉ hỗ trợ phương thức POST' }), {
                status: 405,
                headers: {
                    ...headers,
                    Allow: 'POST',
                },
            });
        }

        try {
            // Lấy dữ liệu từ form-data
            const formData = await request.formData();
            const imageFile = formData.get('image');
            const type = formData.get('type');

            if (!imageFile) {
                throw new Error('Không tìm thấy tệp hình ảnh trong form-data');
            }
            if (!type || type !== 'product') {
                throw new Error('Trường type không hợp lệ hoặc không được cung cấp');
            }

            // Lấy watermark từ R2 bucket
            const watermarkObject = await env.test_togihome.get('togihome-watermark-origin.png');
            if (!watermarkObject) {
                throw new Error('Watermark không tìm thấy trong test-togihome bucket');
            }
            const watermarkUrl = `https://pub-${env.CLOUDFLARE_ACCOUNT_ID}.r2.dev/test-togihome/togihome-watermark-origin.png`;

            // Lấy thông tin từ biến môi trường
            const accountId = env.CLOUDFLARE_ACCOUNT_ID;
            const deliveryAccountId = env.CLOUDFLARE_DELIVERY_ACCOUNT_ID;
            const apiToken = env.CLOUDFLARE_API_TOKEN;

            // Tạo FormData để gửi lên Cloudflare Images API
            const uploadFormData = new FormData();
            uploadFormData.append('file', imageFile);
            uploadFormData.append('metadata', JSON.stringify({
                type: 'product',
                draw: [
                    {
                        url: watermarkUrl,
                        opacity: 0.1,
                        width: 576, // 1920 * 0.3
                        x: 10,
                        y: 10,
                    },
                ],
            }));
            uploadFormData.append('requireSignedURLs', 'false');

            // Gửi yêu cầu tới Cloudflare Images API
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

            // Tạo URL cho hình ảnh
            const imageId = imageResult.result.id;
            const fullUrl = `https://imagedelivery.net/${deliveryAccountId}/${imageId}/productfull`;
            const thumbUrl = `https://imagedelivery.net/${deliveryAccountId}/${imageId}/productthumb`;

            return new Response(JSON.stringify({
                message: 'Upload thành công',
                fileName: imageFile.name,
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