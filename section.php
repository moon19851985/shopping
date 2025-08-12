<?php
session_start();

$user_id = $_SESSION['user_id'];

include('file/header.php')

?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>الاقسام</title>
</head>
<body>
    <main>
    <?php
    $section = $_GET['section'];
    $query = "SELECT * FROM product WHERE prosection ='$section' ORDER BY ID DESC";
    $result = mysqli_query($conn, $query);
    if (mysqli_num_rows($result) > 0) {
        while ($row = mysqli_fetch_assoc($result)) {
    ?>
       <div class="product">
         <div class="product_img">
           <a href="detalis.php?id=<?php echo $row['id']?>">
             <img src="uploads/img//<?php echo $row['proimg'];?>">
             <span class="unavilibal"><?php echo $row['prounv'];?></span>
           </a>
         </div>
         <div class="product_section">
           <a href="detalis.php?id=<?php echo $row['id']?>"><?php echo $row['prosection'];?></a>
         </div>
         <div class="product_name">
           <a href="detalis.php?id=<?php echo $row['id']?>"><?php echo $row['proname'];?></a>
         </div>
         <div class="product_price">
           <a href="detalis.php?id=<?php echo $row['id']?>"><?php echo $row['proprice'];?> &nbsp;السعر </a>
         </div>
         <div class="product_description">
           <a href="detalis.php?id=<?php echo $row['id']?>">
             <i class="fa-solid fa-eye"></i> لتفاصي المنتج اضغط هنا
           </a>
         </div>
         <form action="cart.php?action<?php echo $row['id'];?>" method="post">
           <div class="qty_input">
             <button class="qty_count_mins" type="button">-</button>
             <input class="t" type="number" id="quantity" name="quantity" value="1" min="0" max="7"/>
             <input type="hidden" name="product_id" value="<?php echo $row['id'];?>">
             <input type="hidden" name="h_name" value="<?php echo $row['proname'];?>">
             <input type="hidden" name="h_price" value="<?php echo $row['proprice'];?>">
             <input type="hidden" name="h_img" value="<?php echo $row['proimg'];?>">
             <button class="qty_count_add" type="button">+</button>
           </div>
           <br />
           <div class="submit">
             <button class="addto_Cart" type="submit" name="add" value="add_cart">
               <i class="fa-solid fa-cart-plus">&nbsp; &nbsp;</i>اضف الى السله
             </button>
           </div>
         </form>
       </div>
    <?php
        }
    } else {
        echo '<div class="notification">المنتجات غير متوفره في هذا القسم  </div>';
    }
    ?>
    </main>
</body>
</html>