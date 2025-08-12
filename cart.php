<?php
session_start();
// لايتم اضافة الى الساله الابعد تسجيل الدخول
if(!isset($_SESSION['email'])){
  echo '<script>alert("يجب تسجيل الدخول اولا"); 
  window.location.href="user/login.php";
  </script>';
}
$email = $_SESSION['email'];
//echo "$user_id"; 
if($email <= 0 ){
  echo '<script>alert("مستخدم غير صحيح "); 
  window.location.href="user/login.php";
  </script>';
}

?>
<?php
include('file/header.php');
?>

<?php
@$add =$_POST['add'];
if(isset($_POST['add'])){

    @$ID =$_POST['id'];
    @$productname =$_POST['h_name'];
    @$productprice =$_POST['h_price'];
    @$productimg =$_POST['h_img'];
    @$productquantity =$_POST['quantity'];
    @$product_id =$_POST['product_id'];

 $add_cart="SELECT *FROM cart WHERE name='$productname'  AND email ='$email'";
 $result=mysqli_query($conn,$add_cart);
 if(mysqli_num_rows($result) >0){
echo '<script>alert ("المنتج مضاف مسبقا ");</script>';

 }else{
  if($email > 0){//شرط الاضافة تسجيل الدخول
    $insert_cart="INSERT INTO cart (user_id,email,product_id,name,price,img,quantity) 
    VALUES('$user_id','$email','$product_id','$productname',
    '$productprice','$productimg','$productquantity')";
    if(mysqli_query($conn,$insert_cart) === TRUE){
        echo '<script>alert ("تم اضافة النتج الى سلة الشراء  ");</script>';

    }else{
        echo '<script>alert ("لم تتم اضافة النتج الى سلة الشراء  ");</script>';
    }
 }

}
}
// srart delete
 @$delete_c =$_POST['delete_c'];
 if(isset($_POST['delete_c'])){
      $ID =$_POST['id'];
      if($ID >0){
        $query ="DELETE FROM cart WHERE id='$ID' AND email='$email'";
        $delete =mysqli_query($conn,$query);
        if($delete){
           echo '<script> alert (" تم الحذف      "); </script>';
        } 
        else{
                     echo '<script> alert (" لم يتم الحذف      "); </script>';

        }
      }

 }
//end delete
//start update quantity
if(isset($_POST['update_quantity'])){
    $product_id =$_POST['product_id'];
    $quantity =$_POST['quantity'];
    @$user_id =$_POST['user_id'];
    @$username =$_POST['username'];
    @$email =$_POST['email'];

    if($quantity >0){
        $update_q ="UPDATE cart SET quantity='$quantity' WHERE id='$product_id' 
        AND email='$email'";
        $update =mysqli_query($conn,$update_q);
         if(!$update){
            echo '<script> alert (" لم يتم التعديل      "); </script>';
         }
        if($update){
           echo '<script> alert (" تم التعديل      "); </script>';
        } 
        else{
                     echo '<script> alert (" لم يتم التعديل      "); </script>';

        }
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>سلة الشراء</title>
</head>
<style>
*{
  margin: 0;
  padding: 0;
  box-sizing: border-box;
 }
 h3{
  font-family: Arial ,sans-serif;
  color: #000;

 }
 body{
    font-family: Arial ,sans-serif;
    background-color: #fff;

 }
 .cart_container{
width: 80%;
margin: 50px auto;
background-color: #fff;
padding: 20px;
box-shadow: rgb(0, 0, 0, 0, 0.2);
direction: rtl;


 }
 .cont_head{
  padding: 5px;
  width: 100%;
  height: 100px;
  background-color:rgb(168, 168, 236);
 }
 .cont_head img{
  width: 70px;
  height: 70px;
  float: left;
  border-radius: 20px;
 }
 .cont_head h1{
  float: left;
  margin: 20px;
}
.cart_table{
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 20px;
}
.cart_table th, td{
padding: 15px;
text-align: center;
border: 1px solid #ddd;
}
.cart_table th{
  background-color: #D3D8E4;
}
.cart_table img{
  width: 70px;
  height: 70px;
}
.cart_table td input{
  width: 50px;
  padding: 5px;
  text-align: center;
}
.remove{
  background-color: #0a79a5;
  color: white;
  border: none;
  padding: 10px 10px;
  cursor: pointer;
}
.remove:hover{
  background-color: #0c7feb;
}
 .cart_total h6{
    color: red;
    font-size: larger;
    margin: 20px;
 }

 .cart_total button{
  padding: 10px 40px;
  transition: transform 0.3s ease;
  
 }
  .cart_total button:hover{
    transform: scale(1.2);
  }
 
  .cart_total button a{
   text-decoration:none;
       color:white;


  }
  @media (max-width:1200px){
   .cart_container{
      overflow-x: scroll;
      
   }}
   @media (max-width:600px){
   .cart_container{
      
   }
   h1{
    font-size: 20px;
   }
    .cont_head{
      margin-top:50px ;
  padding: 5px;
  width: 100%;
  height: 80px;
  background-color:rgb(168, 168, 236);
 }
 .cart_table th{
  font-size: 14px;
}
 .cart_table td{
  font-size: 11px;
}

   }
</style>
<body>
    <div class="cart_container">
        <div class="cont_head">
            <img src="img/cart.png">
            <h1>mohamnmed</h1>
        </div>
        <!-----start table-->
        <table class="cart_table">
        <tr>
            <th>صورة المنتج</th>
            <th>رقم المنتج</th>
            <th>اسم المنتج</th>
            <th>الكميه</th>
            <th>السعر</th>
            <th>الاجمالي</th>
            <th>جذف</th>
            <th>تعديل</th>
        </tr>
        <?php
          $query="SELECT * FROM `cart`  WHERE email ='$email'"; 
          $result= mysqli_query($conn,$query);
          $total= 0;
          $has_products = false; // متغير لتحديد وجود منتجات
          if(mysqli_num_rows($result) >0){
            $has_products = true;
            while($row=mysqli_fetch_assoc($result)){
        ?>
        <tr>
            <td><img src="uploads/img//<?php echo $row['img'];?>"></td>
            <td><h3><?php echo $row['product_id'];?></h3></td>
            <td><h3><?php echo $row['name'];?></h3></td>
            <td><input type="text" value="<?php echo $row['quantity'];?>"></td>
            <td><h3><?php echo $row['price'];?></h3></td>
            <td><h3><?php echo number_format($row['quantity'] * $row['price'],2);?></h3></td>
          <!--برمجة الحذف من السله------>
          <td>
            <form action="cart.php" method="post">
              <input type="hidden" name="id" value="<?php echo $row['id'];?>">
            <button class="remove" type="submit" name="delete_c">حذف<i class="fa-solid fa-trash"></i></button>
            </form>
          </td>
          <!--نهاية برمجة  الحذف من السله------>
          <!--برمجة التعديل من السله------>
          <td>
           <form action="cart.php" method="post">
           <input type="hidden" name="product_id" value="<?php echo $row['id'];?>">
           <input type="hidden" name="email" value="<?php echo $row['email'];?>">
           <input type="number" name="quantity" value="<?php echo $row['quantity'];?>">
           <button type="submit" name="update_quantity" class="remove">تعديل<i class="fa-solid fa-pen-to-square"></i></button> 
        </form>         
         </td>
          <!--نهاية التعديل من السله------>
            <?php
            $total +=$row['quantity'] * $row['price'];
            }
        }
        ?>
        </tr>
        </table>
        <!-----end table-->
        <div class="cart_total">
         <h6>الاجمالي <?php echo number_format($total,2);?><span id="total"> SR</span></h6>
         <?php if($has_products): ?>
         <button type="submit" class="remove"><a href="personifo.php"><h2>اتمام الطلب</h2></a></button>
         <?php endif; ?>
        </div>
    </div>
</body>
</html>