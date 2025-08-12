<?php

// تحديث الصفحة تلقائياً كل 20 ثانية باستخدام meta (أفضل دعم للمتصفحات)
echo '<meta http-equiv="refresh" content="20">';

include('include/connected.php');

// عند الضغط على زر تغيير الحالة
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['order_id'], $_POST['new_state'])) {
    $order_id = intval($_POST['order_id']);
    $new_state = $_POST['new_state'];
    $stmt = $conn->prepare("UPDATE orders SET state = ? WHERE id = ?");
    $stmt->bind_param("si", $new_state, $order_id);
    $stmt->execute();
    $stmt->close();
}

// جلب جميع الطلبات بدون شرط الحالة
$query = "SELECT * FROM orders ORDER BY id DESC";
$result = $conn->query($query);

if ($result && $result->num_rows > 0) {
    while ($order = $result->fetch_assoc()) {
        echo "<div style='border:1px solid #ccc; padding:15px; margin-bottom:20px;'>";
        // عرض رقم الطلب الحقيقي ورقم الاستلام ورقم الجوال
        echo "<b>رقم الطلب:</b> " . htmlspecialchars($order['order_number']) . "<br>";
        echo "<b>رقم الاستلام:</b> " . htmlspecialchars($order['pickup_code']) . "<br>";
        echo "<b>اسم العميل:</b> " . htmlspecialchars($order['user_name']) . "<br>";
        echo "<b>رقم الجوال:</b> " . htmlspecialchars($order['phone']) . "<br>";
        echo "<b>العنوان:</b> " . htmlspecialchars($order['address']) . "<br>";
        echo "<b>المنتجات:</b> " . htmlspecialchars($order['items']) . "<br>";
        echo "<b>المبلغ:</b> " . htmlspecialchars($order['total']) . "<br>";
        echo "<b>الحالة الحالية:</b> " . htmlspecialchars($order['state']) . "<br>";
        echo "<form method='post' style='margin-top:10px;'>";
        echo "<input type='hidden' name='order_id' value='" . $order['id'] . "'>";
        // زر خرج لتوصيل (يظهر دائماً)
        echo "<button type='submit' name='new_state' value='خرج لتوصيل'>خرج لتوصيل</button> ";
        // زر تم التسليم (يظهر دائماً)
        echo "<button type='submit' name='new_state' value='تم التسليم'>تم التسليم</button>";
        echo "</form>";
        echo "</div>";
    }
} else {
    echo "<p>لا توجد طلبات حالياً.</p>";
}
?>