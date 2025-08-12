<?php

session_start();

// استقبال بيانات إضافية من POST أو SESSION
$userPhone = isset($_POST['phone']) ? $_POST['phone'] : (isset($_SESSION['userPhone']) ? $_SESSION['userPhone'] : '');
$userAddress = isset($_POST['address']) ? $_POST['address'] : (isset($_SESSION['userAddress']) ? $_SESSION['userAddress'] : '');
// --- تعديل استقبال الوقت المفضل بشكل صحيح ---
$userPreferredTime = isset($_POST['preferred_time']) ? $_POST['preferred_time'] : (isset($_SESSION['userPreferredTime']) ? $_SESSION['userPreferredTime'] : '');

if (isset($_POST['phone'])) $_SESSION['userPhone'] = $userPhone;
if (isset($_POST['address'])) $_SESSION['userAddress'] = $userAddress;
if (isset($_POST['preferred_time'])) $_SESSION['userPreferredTime'] = $userPreferredTime;

// استخدم الاسم الكامل المدخل من صفحة personifo إذا تم إرساله عبر POST
if (isset($_POST['name']) && !empty($_POST['name'])) {
    $userName = $_POST['name'];
    $_SESSION['userName'] = $userName; // احفظه في الجلسة لاستخدامه لاحقاً
} else {
    $userName = isset($_SESSION['userName']) ? $_SESSION['userName'] : '';
}

$userEmail = isset($_SESSION['email']) ? $_SESSION['email'] : '';
$totalAmount = 0;

// جلب الطلبات السابقة (تم التسليم) مرتبة من الأحدث للأقدم
$previousOrders = [];
// جلب الطلبات الحالية (قيد التجهيز أو خرج للتوصيل) مرتبة من الأحدث للأقدم
$currentOrders = [];

// الاتصال بقاعدة البيانات
$host = "localhost";
$db = "shopping";
$user = "root";
$pass = "";

$conn = new mysqli($host, $user, $pass, $db);
$conn->set_charset("utf8");

// جلب المنتجات من جدول cart المرتبطة بإيميل المستخدم مع img
$cart = [];
if ($userEmail && $conn->connect_errno === 0) {
    $stmt = $conn->prepare("SELECT product_id, name, price, quantity, img FROM cart WHERE email = ?");
    $stmt->bind_param("s", $userEmail);
    $stmt->execute();
    $result = $stmt->get_result();
    while ($row = $result->fetch_assoc()) {
        $cart[] = $row;
    }
    $stmt->close();

    // --- حفظ الطلب في جدول الطلبات السابقة قبل حذف السلة ---
    if (count($cart) > 0) {
        // توليد رقم طلب ورقم استلام جديدين فقط عند أول زيارة (وليس عند التحديث)
        if (!isset($_SESSION['orderNumber']) || !isset($_SESSION['pickupCode'])) {
            $_SESSION['orderNumber'] = 'ORD' . date('Ymd') . rand(1000,9999);
            $_SESSION['pickupCode'] = rand(100000,999999);
        }
        $orderNumber = $_SESSION['orderNumber'];
        $pickupCode = $_SESSION['pickupCode'];

        // تجهيز بيانات المنتجات كـ JSON
        $itemsJson = json_encode($cart, JSON_UNESCAPED_UNICODE);

        // حساب الإجمالي
        $totalAmount = 0;
        foreach ($cart as $item) {
            $price = isset($item['price']) ? floatval($item['price']) : 0;
            $qty = isset($item['quantity']) ? intval($item['quantity']) : 0;
            $totalAmount += $price * $qty;
        }

        // إنشاء جدول orders إذا لم يكن موجوداً (مرة واحدة فقط)
        $conn->query("CREATE TABLE IF NOT EXISTS orders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            order_number VARCHAR(32),
            pickup_code VARCHAR(16),
            user_name VARCHAR(255),
            email VARCHAR(255),
            phone VARCHAR(32),
            address TEXT,
            preferred_time VARCHAR(64),
            items TEXT,
            total DECIMAL(10,2),
            state VARCHAR(32) DEFAULT 'قيد التجهيز',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )");

        // --- التأكد من إرسال الوقت المفضل بشكل صحيح ---
        $stmtOrder = $conn->prepare("INSERT INTO orders (order_number, pickup_code, user_name, email, phone, address, preferred_time, items, total, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $state = 'قيد التجهيز';
        $stmtOrder->bind_param("ssssssssds", $orderNumber, $pickupCode, $userName, $userEmail, $userPhone, $userAddress, $userPreferredTime, $itemsJson, $totalAmount, $state);
        $stmtOrder->execute();
        $stmtOrder->close();

        // حذف المنتجات من السلة بعد حفظ الطلب
        $delStmt = $conn->prepare("DELETE FROM cart WHERE email = ?");
        $delStmt->bind_param("s", $userEmail);
        $delStmt->execute();
        $delStmt->close();

        // إعادة تعيين أرقام الطلب للاستعداد لطلب جديد
        unset($_SESSION['orderNumber']);
        unset($_SESSION['pickupCode']);
    }
}

// جلب الطلبات الحالية (قيد التجهيز أو خرج للتوصيل) مرتبة من الأحدث للأقدم
if ($userEmail) {
    $stmtCurr = $conn->prepare("SELECT order_number, pickup_code, items, total, created_at, phone, address, preferred_time, state FROM orders WHERE email = ? AND (state = 'قيد التجهيز' OR state = 'خرج لتوصيل') ORDER BY created_at DESC");
    $stmtCurr->bind_param("s", $userEmail);
    $stmtCurr->execute();
    $resultCurr = $stmtCurr->get_result();
    while ($row = $resultCurr->fetch_assoc()) {
        $row['items'] = json_decode($row['items'], true);
        $currentOrders[] = $row;
    }
    $stmtCurr->close();
}

// جلب الطلبات السابقة (تم التسليم) مرتبة من الأحدث للأقدم
if ($userEmail) {
    $stmtPrev = $conn->prepare("SELECT order_number, pickup_code, items, total, created_at, phone, address, preferred_time, state FROM orders WHERE email = ? AND state = 'تم التسليم' ORDER BY created_at DESC");
    $stmtPrev->bind_param("s", $userEmail);
    $stmtPrev->execute();
    $resultPrev = $stmtPrev->get_result();
    while ($row = $resultPrev->fetch_assoc()) {
        $row['items'] = json_decode($row['items'], true);
        $previousOrders[] = $row;
    }
    $stmtPrev->close();
}
$conn->close();

// حذف طلب سابق من العرض فقط (ليس من قاعدة البيانات)
// لا يتم إخفاء إلا الطلبات التي حالتها "تم التسليم"
if (isset($_POST['hide_order'])) {
    $orderToHide = $_POST['hide_order'];
    $canHide = false;
    foreach ($previousOrders as $order) {
        if ($order['order_number'] === $orderToHide) {
            $canHide = true;
            break;
        }
    }
    if ($canHide) {
        if (isset($_SESSION['hidden_orders'])) {
            if (!in_array($orderToHide, $_SESSION['hidden_orders'])) {
                $_SESSION['hidden_orders'][] = $orderToHide;
            }
        } else {
            $_SESSION['hidden_orders'] = [$orderToHide];
        }
    }
}
$hiddenOrders = isset($_SESSION['hidden_orders']) ? $_SESSION['hidden_orders'] : [];

// توليد رقم طلب ورقم استلام جديدين فقط عند أول زيارة (وليس عند التحديث)
if (!isset($orderNumber) || !isset($pickupCode)) {
    if (!isset($_SESSION['orderNumber']) || !isset($_SESSION['pickupCode'])) {
        $_SESSION['orderNumber'] = 'ORD' . date('Ymd') . rand(1000,9999);
        $_SESSION['pickupCode'] = rand(100000,999999);
    }
    $orderNumber = $_SESSION['orderNumber'];
    $pickupCode = $_SESSION['pickupCode'];
}
?>
<!DOCTYPE html>
<html lang="ar">
<head>
   
     <meta charset="UTF-8">
    <title>تأكيد الطلب</title>
    <style>
        /* ...existing CSS... */
    </style>
    <script>
    // تحديث الصفحة تلقائياً كل 5 ثانيه (5,000 مللي ثانية)
    setInterval(function(){
        window.location.reload();
    }, 5000);
    </script>
    <style>
     body { font-family: 'Cairo', Arial, sans-serif; background: #f7f7fa; margin: 0; padding: 0; direction: rtl; }
        .container { max-width: 700px; margin: 40px auto; background: #fff; border-radius: 16px; box-shadow: 0 2px 18px rgba(0,0,0,0.09); padding: 36px 22px 22px 22px; direction: rtl; }
        h2 { text-align: center; color: #1976d2; margin-bottom: 18px; }
        .order-info { background: #f0f4fa; border-radius: 10px; padding: 18px; margin-bottom: 22px; color: #1976d2; font-size: 1.1em; direction: rtl; }
        .user-info { margin-bottom: 18px; color: #444; background: #f9f9f9; border-radius: 8px; padding: 12px; direction: rtl; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; direction: rtl; }
        th, td { padding: 12px; border-bottom: 1px solid #eee; text-align: center; direction: rtl; }
        th { background: #f0f4fa; color: #1976d2; }
        .total { font-weight: bold; color: #1976d2; background: #f9f9f9; }
        .empty-cart { color:#d32f2f;text-align:center;font-weight:bold; }
        .back-link { display:inline-block;margin-top:20px;color:#1976d2;text-decoration:underline; }
        .thanks { text-align:center; color:#388e3c; font-size:1.2em; margin-bottom:18px; }
        .pickup-code { font-size:1.2em; color:#d32f2f; font-weight:bold; letter-spacing:2px; }
        .prev-orders { margin-top:40px; background:#f9f9f9; border-radius:12px; padding:18px; }
        .prev-orders h3 { color:#1976d2; margin-bottom:12px; text-align:center; }
        .prev-order-table { margin-bottom:30px; border:1px solid #e0e0e0; border-radius:8px; background:#fff; }
        .prev-order-table th, .prev-order-table td { font-size:0.97em; }
        .order-state { margin-bottom: 18px; }
        .current-orders { margin-bottom: 40px; background: #e3f2fd; border-radius: 12px; padding: 18px; }
        .current-orders h3 { color: #1976d2; margin-bottom: 12px; text-align: center; }
        .hide-btn { background: #d32f2f; color: #fff; border: none; border-radius: 6px; padding: 6px 18px; cursor: pointer; font-size: 0.95em; margin-top: 8px; }
        @media (max-width: 600px) {
            .container { padding: 10px 2px; }
            th, td { font-size: 0.95em; padding: 7px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <?php if (count($cart) > 0): ?>
            <h2>تم إرسال طلب جديد بنجاح</h2>
            <div class="thanks">شكراً لثقتك بنا! تم استلام طلبك بنجاح.</div>
            <div class="order-info">
                <div>رقم الطلب: <b><?php echo $orderNumber; ?></b></div>
                <div>رقم الاستلام: <span class="pickup-code"><?php echo $pickupCode; ?></span></div>
            </div>
            <div class="user-info">
                <b>اسم العميل:</b> <?php echo htmlspecialchars($userName); ?><br>
                <b>البريد الإلكتروني:</b> <?php echo htmlspecialchars($userEmail); ?><br>
                <b>رقم الجوال:</b> <?php echo htmlspecialchars($userPhone); ?><br>
                <b>العنوان:</b>
                <a href="https://www.google.com/maps/search/?api=1&query=<?php echo urlencode($userAddress); ?>" target="_blank" style="color:#1976d2;text-decoration:underline;">
                    <?php echo htmlspecialchars($userAddress); ?>
                </a>
                <br>
                <b>الوقت المفضل للتوصيل:</b> <?php echo htmlspecialchars($userPreferredTime); ?><br>
            </div>
            <div class="order-state">
                <b>حالة الطلب:</b> <span style="color:#d32f2f;font-weight:bold;">قيد التجهيز</span>
            </div>
            <table>
                <tr>
                    <th>صورة المنتج</th>
                    <th>رقم الصنف</th>
                    <th>اسم المنتج</th>
                    <th>السعر</th>
                    <th>الكمية</th>
                    <th>الإجمالي</th>
                </tr>
                <?php foreach ($cart as $item): 
                    $product_id = isset($item['product_id']) ? $item['product_id'] : '-';
                    $name = isset($item['name']) ? $item['name'] : 'منتج';
                    $price = isset($item['price']) ? floatval($item['price']) : 0;
                    $qty = isset($item['quantity']) ? intval($item['quantity']) : 0;
                    $img = isset($item['img']) ? $item['img'] : '';
                    $subtotal = $price * $qty;
                    $totalAmount += $subtotal;
                ?>
                <tr>
                    <td>
                        <?php if ($img): ?>
                            <img src="uploads/img/<?php echo htmlspecialchars($img); ?>" alt="صورة المنتج" style="width:50px;height:50px;border-radius:8px;">
                        <?php else: ?>
                            -
                        <?php endif; ?>
                    </td>
                    <td><?php echo htmlspecialchars($product_id); ?></td>
                    <td><?php echo htmlspecialchars($name); ?></td>
                    <td><?php echo number_format($price, 2); ?> ريال</td>
                    <td><?php echo $qty; ?></td>
                    <td><?php echo number_format($subtotal, 2); ?> ريال</td>
                </tr>
                <?php endforeach; ?>
                <tr>
                    <td colspan="5" class="total">الإجمالي الكلي</td>
                    <td class="total"><?php echo number_format($totalAmount, 2); ?> ريال</td>
                </tr>
            </table>
        <?php endif; ?>

        <!-- الطلبات الحالية (قيد التجهيز أو خرج للتوصيل) -->
        <?php if (count($currentOrders) > 0): ?>
        <div class="current-orders">
            <h3>طلباتك الحالية</h3>
            <?php foreach ($currentOrders as $order): ?>
                <div class="prev-order-table">
                    <div style="margin-bottom:8px;">
                        <b>رقم الطلب:</b> <?php echo htmlspecialchars($order['order_number']); ?> &nbsp; 
                        <b>رقم الاستلام:</b> <span class="pickup-code"><?php echo htmlspecialchars($order['pickup_code']); ?></span>
                        <span style="float:left;color:#888;font-size:0.95em;"><?php echo htmlspecialchars($order['created_at']); ?></span>
                    </div>
                    <div style="margin-bottom:8px;">
                        <b>رقم الجوال:</b> <?php echo htmlspecialchars($order['phone']); ?> &nbsp; 
                        <b>العنوان:</b>
                        <a href="https://www.google.com/maps/search/?api=1&query=<?php echo urlencode($order['address']); ?>" target="_blank" style="color:#1976d2;text-decoration:underline;">
                            <?php echo htmlspecialchars($order['address']); ?>
                        </a>
                        &nbsp; 
                        <b>الوقت المفضل:</b> <?php echo htmlspecialchars($order['preferred_time']); ?>
                    </div>
                    <div style="margin-bottom:8px;">
                        <b>حالة الطلب:</b> <span style="color:#d32f2f;font-weight:bold;"><?php echo htmlspecialchars($order['state']); ?></span>
                    </div>
                    <table style="width:100%;margin-bottom:0;">
                        <tr>
                            <th>صورة المنتج</th>
                            <th>رقم الصنف</th>
                            <th>اسم المنتج</th>
                            <th>السعر</th>
                            <th>الكمية</th>
                            <th>الإجمالي</th>
                        </tr>
                        <?php
                        $orderTotal = 0;
                        if (is_array($order['items'])):
                            foreach ($order['items'] as $item):
                                $product_id = isset($item['product_id']) ? $item['product_id'] : '-';
                                $name = isset($item['name']) ? $item['name'] : 'منتج';
                                $price = isset($item['price']) ? floatval($item['price']) : 0;
                                $qty = isset($item['quantity']) ? intval($item['quantity']) : 0;
                                $img = isset($item['img']) ? $item['img'] : '';
                                $subtotal = $price * $qty;
                                $orderTotal += $subtotal;
                        ?>
                        <tr>
                            <td>
                                <?php if ($img): ?>
                                    <img src="uploads/img/<?php echo htmlspecialchars($img); ?>" alt="صورة المنتج" style="width:50px;height:50px;border-radius:8px;">
                                <?php else: ?>
                                    -
                                <?php endif; ?>
                            </td>
                            <td><?php echo htmlspecialchars($product_id); ?></td>
                            <td><?php echo htmlspecialchars($name); ?></td>
                            <td><?php echo number_format($price, 2); ?> ريال</td>
                            <td><?php echo $qty; ?></td>
                            <td><?php echo number_format($subtotal, 2); ?> ريال</td>
                        </tr>
                        <?php endforeach; endif; ?>
                        <tr>
                            <td colspan="5" class="total">الإجمالي الكلي</td>
                            <td class="total"><?php echo number_format($order['total'], 2); ?> ريال</td>
                        </tr>
                    </table>
                </div>
            <?php endforeach; ?>
        </div>
        <?php endif; ?>

        <!-- عرض الطلبات السابقة -->
        <?php
        // إخفاء الطلبات السابقة التي تم حذفها من العرض فقط
        $filteredPreviousOrders = [];
        foreach ($previousOrders as $order) {
            if (!in_array($order['order_number'], $hiddenOrders)) {
                $filteredPreviousOrders[] = $order;
            }
        }
        ?>
        <?php if (count($filteredPreviousOrders) > 0): ?>
        <div class="prev-orders">
            <h3>الطلبات السابقة الخاصة بك</h3>
            <?php foreach ($filteredPreviousOrders as $order): ?>
                <div class="prev-order-table">
                    <div style="margin-bottom:8px;">
                        <b>رقم الطلب:</b> <?php echo htmlspecialchars($order['order_number']); ?> &nbsp; 
                        <b>رقم الاستلام:</b> <span class="pickup-code"><?php echo htmlspecialchars($order['pickup_code']); ?></span>
                        <span style="float:left;color:#888;font-size:0.95em;"><?php echo htmlspecialchars($order['created_at']); ?></span>
                    </div>
                    <div style="margin-bottom:8px;">
                        <b>رقم الجوال:</b> <?php echo htmlspecialchars($order['phone']); ?> &nbsp; 
                        <b>العنوان:</b>
                        <a href="https://www.google.com/maps/search/?api=1&query=<?php echo urlencode($order['address']); ?>" target="_blank" style="color:#1976d2;text-decoration:underline;">
                            <?php echo htmlspecialchars($order['address']); ?>
                        </a>
                        &nbsp; 
                        <b>الوقت المفضل:</b> <?php echo htmlspecialchars($order['preferred_time']); ?>
                    </div>
                    <div style="margin-bottom:8px;">
                        <b>حالة الطلب:</b> <span style="color:#388e3c;font-weight:bold;"><?php echo htmlspecialchars($order['state']); ?></span>
                    </div>
                    <form method="post" style="margin-bottom:0;">
                        <input type="hidden" name="hide_order" value="<?php echo htmlspecialchars($order['order_number']); ?>">
                        <button type="submit" class="hide-btn" onclick="return confirm('هل أنت متأكد من إخفاء هذا الطلب من القائمة؟');">إخفاء الطلب من القائمة</button>
                    </form>
                    <table style="width:100%;margin-bottom:0;">
                        <tr>
                            <th>صورة المنتج</th>
                            <th>رقم الصنف</th>
                            <th>اسم المنتج</th>
                            <th>السعر</th>
                            <th>الكمية</th>
                            <th>الإجمالي</th>
                        </tr>
                        <?php
                        $orderTotal = 0;
                        if (is_array($order['items'])):
                            foreach ($order['items'] as $item):
                                $product_id = isset($item['product_id']) ? $item['product_id'] : '-';
                                $name = isset($item['name']) ? $item['name'] : 'منتج';
                                $price = isset($item['price']) ? floatval($item['price']) : 0;
                                $qty = isset($item['quantity']) ? intval($item['quantity']) : 0;
                                $img = isset($item['img']) ? $item['img'] : '';
                                $subtotal = $price * $qty;
                                $orderTotal += $subtotal;
                        ?>
                        <tr>
                            <td>
                                <?php if ($img): ?>
                                    <img src="uploads/img/<?php echo htmlspecialchars($img); ?>" alt="صورة المنتج" style="width:50px;height:50px;border-radius:8px;">
                                <?php else: ?>
                                    -
                                <?php endif; ?>
                            </td>
                            <td><?php echo htmlspecialchars($product_id); ?></td>
                            <td><?php echo htmlspecialchars($name); ?></td>
                            <td><?php echo number_format($price, 2); ?> ريال</td>
                            <td><?php echo $qty; ?></td>
                            <td><?php echo number_format($subtotal, 2); ?> ريال</td>
                        </tr>
                        <?php endforeach; endif; ?>
                        <tr>
                            <td colspan="5" class="total">الإجمالي الكلي</td>
                            <td class="total"><?php echo number_format($order['total'], 2); ?> ريال</td>
                        </tr>
                    </table>
                </div>
            <?php endforeach; ?>
        </div>
        <?php endif; ?>

        <a href="index.php" class="back-link">العودة للمتجر</a>
    </div>
</body>
</html>