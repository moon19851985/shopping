<?php
session_start();
// لايتم اضافة الى الساله الابعد تسجيل الدخول
//if(!isset($_SESSION['user_id'])){
  //echo '<script>alert("يجب تسجيل الدخول اولا"); 
 // window.location.href="user/login.php";
  //</script>';
//}
//$user_id = $_SESSION['user_id'];
//echo "$user_id"; 
//if($user_id <= 0 ){
 // echo '<script>alert("مستخدم غير صحيح "); 
  //window.location.href="user/login.php";
 // </script>';
//}

?>


<?php
include('file/header.php');


?>



<main>
  <!----جلب البياتنات من --->
  <?php

   $query="SELECT * FROM product";
   $result=mysqli_query($conn,$query);
   while($row=mysqli_fetch_assoc($result)){
    
  

  ?>
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
  </head>
  <body>
    <style>
    
    </style>
  </body>
  </html>
   
   <div class="product">
     <div class="product_img"><a href="detalis.php?id=<?php echo $row['id']?>">
       <img src="uploads/img//<?php echo $row['proimg'];?>">
       <span class="unavilibal"><?php echo $row['prounv'];?></span>
       <a href=""></a>
     </div>
     <div class="product_section">
      <a href="section.php?section=<?php echo $row ['prosection'];?>"><?php echo $row['prosection'];?></a></div>
     <div class="product_name">
      <a href="detalis.php?id=<?php echo $row['id']?>"><?php echo $row['proname'];?></a></div>
     <div class="product_price">
      <a href="detalis.php?id=<?php echo $row['id']?>"><?php echo $row['proprice'];?> &nbsp;السعر </a></div>
     <div class="product_description">
      <a href="detalis.php?id=<?php echo $row['id']?>"><i class="fa-solid fa-eye"></i> لتفاصي المنتج اضغط هنا</a></div>
     
      <div class="qty_input">
        <form action="cart.php?action<?php echo $row ['id'];?>" method="post">
        <button class="qty_count_mins">-</button>
        <input class="t" type="number"  id="quantity" name="quantity" value="1" min="0" max="7"/>
        <input type="hidden" name="product_id" value="<?php echo $row ['id'];?>">
        <input type="hidden" name="h_name" value="<?php echo $row['proname'];?>" >
        <input type="hidden" name="h_price" value="<?php echo $row['proprice'];?>" >
        <input type="hidden" name="h_img" value="<?php echo $row['proimg'];?>" >


        <button class="qty_count_add" type="submit">+</button>
      </div><br />
     <div class="submit"><a href="">
     <button class="addto_Cart" type="submit" name="add" value="add_cart">
      <i class="fa-solid fa-cart-plus">&nbsp; &nbsp;</i>
     اضف الى السله</button>
     </a>
     </div>
     </form>
   </div>
   <?php

   }  
   ?>     
 </main>
<br >
<br >
<?php
include('file/footer.php');


?>