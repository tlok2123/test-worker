import { PhotonImage, watermark, resize } from "@cf-wasm/photon";
import photonWasm from "@cf-wasm/photon/photon.wasm";

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
                headers: { ...headers, Allow: 'POST' },
            });
        }

        try {
            // Kiểm tra binding R2
            if (!env.test_togihome) {
                throw new Error('Binding test_togihome không được định nghĩa trong env');
            }

            // Lấy dữ liệu từ form-data
            const formData = await request.formData();
            const imageFile = formData.get('image');
            const type = formData.get('type');

            // Kiểm tra tệp hình ảnh và loại
            if (!imageFile) {
                throw new Error('Không tìm thấy tệp hình ảnh trong form-data');
            }
            if (!['image/png', 'image/jpeg'].includes(imageFile.type)) {
                throw new Error('Định dạng hình ảnh không được hỗ trợ');
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

            // Kiểm tra buffer hợp lệ
            if (imageBuffer.byteLength === 0) {
                throw new Error('Tệp hình ảnh rỗng hoặc không hợp lệ');
            }
            if (watermarkBuffer.byteLength === 0) {
                throw new Error('Tệp watermark rỗng hoặc không hợp lệ');
            }

            // Tạo PhotonImage từ buffer
            const mainImage = new PhotonImage(new Uint8Array(imageBuffer));
            const watermarkImage = new PhotonImage(new Uint8Array(watermarkBuffer));

            // Resize watermark
            const watermarkWidth = 576;
            const watermarkHeight = 576;
            const resizedWatermark = resize(watermarkImage, watermarkWidth, watermarkHeight, 1); // Nearest neighbor

            // Tính toán vị trí watermark
            const x = Math.floor(mainImage.get_width() / 2 - watermarkWidth / 2);
            const y = Math.floor(mainImage.get_height() / 2 - watermarkHeight / 2);

            // Áp dụng watermark
            watermark(mainImage, resizedWatermark, x, y, 0.1, watermarkWidth, watermarkHeight);

            // Lấy dữ liệu ảnh đã xử lý
            const processedImageBuffer = mainImage.get_bytes();

            // Giải phóng bộ nhớ
            mainImage.free();
            watermarkImage.free();
            resizedWatermark.free();

            // Upload lên Cloudflare Images
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
            if (!imageResult.success) {
                console.error('Image API Errors:', imageResult.errors);
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