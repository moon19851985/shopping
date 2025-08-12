<?php
// الاتصال بقاعدة البيانات
$conn = new mysqli("localhost", "root", "", "shopping");
if ($conn->connect_error) {
    die("فشل الاتصال: " . $conn->connect_error);
}

// استقبال رقم الطلب من النموذج
$order_code = isset($_GET['order_number']) ? trim($_GET['order_number']) : '';

if ($order_code) {
    // البحث عن الطلب في جدول الطلبات
    $sql = "SELECT * FROM order_done WHERE order_code = ?";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param("s", $order_code);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($row = $result->fetch_assoc()) {
        echo "<h2>معلومات الطلب</h2>";
        echo "<p>رقم الطلب: " . htmlspecialchars($row['order_code']) . "</p>";
        echo "<p>إجمالي السعر: " . number_format($row['total_price'], 2) . " ريال</p>";
        echo "<p>رقم الاستلام: " . htmlspecialchars($row['pickup_code']) . "</p>";
        echo "<p>تاريخ الطلب: " . htmlspecialchars($row['created_at']) . "</p>";
        echo "<p>حالة الطلب: " . htmlspecialchars($row['status']) . "</p>";
        // يمكنك عرض تفاصيل أكثر حسب الأعمدة الموجودة لديك
    } else {
        echo "<p style='color:red;'>لم يتم العثور على طلب بهذا الرقم.</p>";
    }
} else {
    echo "<p style='color:red;'>يرجى إدخال رقم الطلب.</p>";
}

$conn->close();
?>