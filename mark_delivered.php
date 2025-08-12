<?php

session_start();
include("include/connected.php");

// التأكد من أن المستخدم مسؤول (يمكنك تعديل هذا الشرط حسب نظام الصلاحيات لديك)
if (!isset($_SESSION['email'])) {
    header("Location: login.php");
    exit();
}

// عند الضغط على زر "تم الاستلام من العميل" يتم تحديث حالة الطلب
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['order_id'])) {
    $order_id = intval($_POST['order_id']);
    $update = mysqli_query($conn, "UPDATE order_done SET status='delivered' WHERE id=$order_id");
}

// جلب جميع الطلبات من جدول order_done
$query = "SELECT id, user_id, email, total_price, pickup_code, order_code, created_at, status FROM order_done WHERE 1 ORDER BY created_at DESC";
$result = mysqli_query($conn, $query);
?>
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>حالة الطلبات الموكده</title>
    <style>
        body { font-family: 'Cairo', Arial, sans-serif; background: #f7f7fa; }
        .container { max-width: 900px; margin: 40px auto; background: #fff; border-radius: 14px; box-shadow: 0 2px 16px rgba(0,0,0,0.07); padding: 32px 18px; }
        h2 { text-align: center; color: #1976d2; margin-bottom: 18px; }
        table { width: 100%; border-collapse: collapse; margin-top: 18px; }
        th, td { padding: 10px; border: 1px solid #d1d5db; text-align: center; }
        th { background: #1976d2; color: #fff; }
        .btn-done { background: #388e3c; color: #fff; border: none; padding: 7px 18px; border-radius: 6px; font-weight: bold; cursor: pointer; }
        .btn-done:hover { background: #1976d2; }
        .delivered { background: #e0ffe0; }
    </style>
</head>
<body>
    <div class="container">
        <h2>الطلبات المنجزة</h2>
        <table>
            <tr>
                <th>رقم الطلب</th>
                <th>المستخدم</th>
                <th>الإيميل</th>
                <th>السعر الإجمالي</th>
                <th>كود الاستلام</th>
                <th>كود الطلب</th>
                <th>تاريخ الإنشاء</th>
                <th>الحالة</th>
                <th>إجراء</th>
            </tr>
            <?php while($row = mysqli_fetch_assoc($result)): ?>
            <tr class="<?php echo ($row['status'] == 'delivered') ? 'delivered' : ''; ?>">
                <td><?php echo htmlspecialchars($row['id']); ?></td>
                <td><?php echo htmlspecialchars($row['user_id']); ?></td>
                <td><?php echo htmlspecialchars($row['email']); ?></td>
                <td><?php echo htmlspecialchars($row['total_price']); ?></td>
                <td><?php echo htmlspecialchars($row['pickup_code']); ?></td>
                <td><?php echo htmlspecialchars($row['order_code']); ?></td>
                <td><?php echo htmlspecialchars($row['created_at']); ?></td>
                <td><?php echo htmlspecialchars($row['status']); ?></td>
                <td>
                    <?php if($row['status'] != 'delivered'): ?>
                    <form method="post" action="mark_delivered.php" style="margin:0;">
                        <input type="hidden" name="order_id" value="<?php echo $row['id']; ?>">
                        <button type="submit" class="btn-done" onclick="return confirm('هل تم الاستلام من العميل؟');">تم الاستلام من العميل</button>
                    </form>
                    <?php else: ?>
                        تم التسليم
                    <?php endif; ?>
                </td>
            </tr>
            <?php endwhile; ?>
        </table>
    </div>
</body>
</html>