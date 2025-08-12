<?php


session_start();
// تعريف اسم المستخدم والإيميل من الجلسة أو ضع قيمة افتراضية
$userName = isset($_SESSION['userName']) ? $_SESSION['userName'] : '';
$userEmail = isset($_SESSION['email']) ? $_SESSION['email'] : '';

// حساب المبلغ الإجمالي من السلة المرتبطة بالإيميل (مع التأكد من القيم)
$totalAmount = 0;
if (isset($_SESSION['cart']) && is_array($_SESSION['cart'])) {
    foreach ($_SESSION['cart'] as $item) {
        // تأكد أن price و qty موجودة وقيمتها رقمية
        $price = (isset($item['price']) && is_numeric($item['price'])) ? floatval($item['price']) : 0;
        $qty   = (isset($item['qty']) && is_numeric($item['qty'])) ? intval($item['qty']) : 0;
        if ($price > 0 && $qty > 0) {
            $totalAmount += $price * $qty;
        }
    }
}
?>
<!DOCTYPE html>
<html lang="ar">
<head>
    <meta charset="UTF-8">
    <title>معلومات الطلب</title>
    <style>
        body { font-family: 'Cairo', Arial, sans-serif; background: #f7f7fa; margin: 0; padding: 0; }
        .container { max-width: 480px; margin: 40px auto; background: #fff; border-radius: 16px; box-shadow: 0 2px 18px rgba(0,0,0,0.09); padding: 36px 22px 22px 22px; }
        h2 { text-align: center; color: #1976d2; margin-bottom: 18px; }
        #welcome-user { text-align:center; margin-bottom:18px; font-weight:bold; color:#1976d2; }
        label { display: block; margin-bottom: 6px; font-weight: bold; }
        input, select, textarea { width: 100%; padding: 10px 8px; margin-bottom: 16px; border: 1px solid #d1d5db; border-radius: 6px; background: #fafafa; font-size: 1rem; }
        textarea { min-height: 60px; resize: vertical; }
        .payment-methods, .delivery-methods { display: flex; gap: 10px; margin-bottom: 18px; }
        .payment-methods label, .delivery-methods label { font-weight: normal; }
        .custom-btn { width: 100%; background: #1976d2; color: #fff; border: none; padding: 13px 0; border-radius: 7px; font-size: 1.13rem; font-weight: 700; cursor: pointer; transition: background 0.2s; }
        .custom-btn:hover { background: #388e3c; }
        .success-msg { color: #388e3c; text-align: center; font-weight: bold; margin-top: 18px; }
        #user-location { margin: 20px 0; text-align: center; }
        #map { width: 100%; height: 300px; border-radius: 10px; margin-bottom: 16px; }
        #location-status { color: #1976d2; margin-bottom: 10px; font-size: 0.95em; }
        .row-flex { display: flex; gap: 10px; }
        .row-flex > div { flex: 1; }
    </style>
    <!-- Leaflet CSS -->
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
</head>
<body>
    <div class="container">
        <h2>إتمام الطلب</h2>
        <div id="welcome-user">
            مرحباً <?php echo htmlspecialchars($userName); ?>
            <?php if($userEmail): ?>
                <br><span style="font-size:0.95em;color:#555;"><?php echo htmlspecialchars($userEmail); ?></span>
            <?php endif; ?>
        </div>
        <form id="orderForm" method="POST" action="confirmed_order.php" autocomplete="off">
            <label for="name">الاسم الكامل</label>
            <input type="text" id="name" name="name" required value="<?php echo htmlspecialchars($userName); ?>">

            <label for="email">البريد الإلكتروني</label>
            <input type="email" id="email" name="email" required value="<?php echo htmlspecialchars($userEmail); ?>"readonly>

            <div class="row-flex">
                <div>
                    <label for="phone">رقم الجوال</label>
                    <input type="text" id="phone" name="phone" required pattern="^05\d{8}$" placeholder="05xxxxxxxx">
                </div>
                <div>
                    <label for="city">المدينة</label>
                    <select id="city" name="city" required>
                        <option value="">اختر المدينة</option>
                        <option value="تبوك">تبوك</option>
                    </select>
                </div>
            </div>

            <label for="address">العنوان التفصيلي</label>
            <input type="text" id="address" name="address" required placeholder="اسم الشارع، رقم المبنى، إلخ">

            <!-- خريطة مجانية (OpenStreetMap عبر Leaflet) -->
            <div id="map"></div>
            <div id="location-status"></div>
            <input type="hidden" id="map_location" name="map_location">

            <label>طريقة التوصيل</label>
            <div class="delivery-methods">
                <label><input type="radio" name="delivery" value="delivery" checked> توصيل للمنزل</label>
                <label><input type="radio" name="delivery" value="pickup"> استلام من الفرع</label>
            </div>

            <div id="deliveryTimeDiv">
                <label for="delivery_time">وقت التوصيل المفضل</label>
                <select id="delivery_time" name="preferred_time">
                    <option value="">اختر الوقت</option>
                    <option value="09:00-12:00">9 صباحاً - 12 ظهراً</option>
                    <option value="12:00-15:00">12 ظهراً - 3 عصراً</option>
                    <option value="15:00-18:00">3 عصراً - 6 مساءً</option>
                    <option value="18:00-21:00">6 مساءً - 9 مساءً</option>
                </select>
            </div>

            <label>طريقة الدفع</label>
            <div class="payment-methods">
                <label><input type="radio" name="payment" value="cod" checked> عند الاستلام</label>
            </div>

            <div style="margin-top:10px; color:#1976d2; font-weight:bold; font-size:1.1em;">
                المبلغ الإجمالي: <span id="totalAmount"><?php echo number_format($totalAmount, 2); ?></span> ريال
            </div>

            <label for="notes">ملاحظات إضافية للطلب (اختياري)</label>
            <textarea id="notes" name="notes" placeholder="أي تفاصيل أو تعليمات إضافية..."></textarea>

            <button type="submit" class="custom-btn">إتمام الطلب</button>
        </form>
    </div>
    <!-- Leaflet JS -->
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
        // خريطة مجانية عبر OpenStreetMap + Leaflet.js
        var map = L.map('map').setView([28.3838, 36.5662], 12); // تبوك كنقطة بداية
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap'
        }).addTo(map);

        var marker;
        // جلب الموقع الحالي
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(function(pos) {
                var lat = pos.coords.latitude;
                var lng = pos.coords.longitude;
                map.setView([lat, lng], 15);
                marker = L.marker([lat, lng], {draggable:true}).addTo(map);
                setAddressFromLatLng(lat, lng);
                marker.on('dragend', function(e) {
                    var latlng = marker.getLatLng();
                    setAddressFromLatLng(latlng.lat, latlng.lng);
                });
            }, function() {
                document.getElementById('location-status').textContent = "تعذر تحديد موقعك تلقائياً. يمكنك اختيار الموقع يدوياً.";
            });
        } else {
            document.getElementById('location-status').textContent = "المتصفح لا يدعم تحديد الموقع.";
        }
        // عند الضغط على الخريطة
        map.on('click', function(e) {
            if (!marker) {
                marker = L.marker(e.latlng, {draggable:true}).addTo(map);
                marker.on('dragend', function(e) {
                    var latlng = marker.getLatLng();
                    setAddressFromLatLng(latlng.lat, latlng.lng);
                });
            } else {
                marker.setLatLng(e.latlng);
            }
            setAddressFromLatLng(e.latlng.lat, e.latlng.lng);
        });

        // جلب العنوان من الإحداثيات فقط بالشكل المطلوب
        function setAddressFromLatLng(lat, lng) {
            document.getElementById('location-status').textContent = "جاري جلب العنوان...";
            // الإحداثيات فقط بالشكل المطلوب
            let coords = `${lat},${lng}`;
            document.getElementById('address').value = coords;
            document.getElementById('map_location').value = coords;
            document.getElementById('location-status').textContent = "تم تحديد الموقع ويمكنك نسخ الإحداثيات مباشرة.";
        }

        // إظهار/إخفاء وقت التوصيل حسب طريقة التوصيل
        document.querySelectorAll('input[name="delivery"]').forEach(function(radio) {
            radio.addEventListener('change', function() {
                var deliveryTimeDiv = document.getElementById('deliveryTimeDiv');
                if (this.value === 'pickup') {
                    deliveryTimeDiv.style.display = 'none';
                } else {
                    deliveryTimeDiv.style.display = 'block';
                }
            });
        });
        window.addEventListener('DOMContentLoaded', function() {
            // إظهار أو إخفاء وقت التوصيل عند التحميل
            var delivery = document.querySelector('input[name="delivery"]:checked').value;
            document.getElementById('deliveryTimeDiv').style.display = (delivery === 'pickup') ? 'none' : 'block';
        });

        document.getElementById('orderForm').onsubmit = function(e) {
            // لا حاجة لتخزين الموقع في localStorage، يتم تعبئته تلقائياً في الحقول
        };
    </script>
</body>
</html>