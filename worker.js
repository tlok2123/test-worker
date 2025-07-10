import { PhotonImage, watermark } from "@cf-wasm/photon";

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
            // Kiểm tra binding R2
            if (!env.test_togihome) {
                throw new Error('Binding test_togihome không được định nghĩa trong env');
            }
            console.log('R2 binding test_togihome:', env.test_togihome);

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

            // Lấy watermark từ R2
            const watermarkObject = await env.test_togihome.get('togihome-watermark-origin.png');
            if (!watermarkObject) {
                throw new Error('Watermark togihome-watermark-origin.png không tìm thấy trong test-togihome bucket');
            }

            // Chuyển đổi ảnh và watermark sang ArrayBuffer
            const imageBuffer = await imageFile.arrayBuffer();
            const watermarkBuffer = await watermarkObject.arrayBuffer();

            // Tạo PhotonImage từ buffer
            const mainImage = new PhotonImage(new Uint8Array(imageBuffer));
            const watermarkImage = new PhotonImage(new Uint8Array(watermarkBuffer));

            // Áp dụng watermark
            watermark(mainImage, watermarkImage, {
                opacity: 0.1,
                width: 576,
                height: 576,
                x: Math.floor(mainImage.get_width() / 2 - 576 / 2), // Căn giữa theo x
                y: Math.floor(mainImage.get_height() / 2 - 576 / 2), // Căn giữa theo y
            });

            // Lấy dữ liệu ảnh đã xử lý
            const processedImageBuffer = mainImage.get_bytes();

            // Giải phóng bộ nhớ
            mainImage.free();
            watermarkImage.free();

            // Chuẩn bị upload lên Cloudflare Images
            const accountId = env.CLOUDFLARE_ACCOUNT_ID;
            const deliveryAccountId = env.CLOUDFLARE_DELIVERY_ACCOUNT_ID;
            const apiToken = env.CLOUDFLARE_API_TOKEN;

            const uploadFormData = new FormData();
            uploadFormData.append('file', new Blob([processedImageBuffer], { type: imageFile.type }));
            uploadFormData.append('requireSignedURLs', 'false');

            const imageResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiToken}`,
                },
                body: uploadFormData,
            });

            const imageResult = await imageResponse.json();
            console.log('Image API Response:', imageResult);
            if (!imageResult.success) {
                throw new Error(`Upload thất bại: ${imageResult.errors[0].message}`);
            }

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