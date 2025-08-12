<?php
include('file/header.php');
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
     .notification{
  width: 1000px;
  height: 50px;
  background-color: #cceeee;
  border: 2px solid red;
  margin: 140px 130px;
  padding: 10px;
  font-size: 40px;
  color: #000;
  text-align: center;
 }
   </style> 
</body>
</html>
<?php

if(isset($_GET['btn_search']))   //---اذا تم الضغط على زر البحث نفذ ما يلي
{
    $search =$_GET['search']; // المتغير يساوي القيمه
    $query ="SELECT *FROM product WHERE prodescript LIKE '%  $search%' or proname LIKE '%$search%'
     or id LIKE '%$search%'  or proprice LIKE '%$search%'";
     $result = mysqli_query($conn,$query);
     if(mysqli_num_rows($result) > 0){
        while($row = mysqli_fetch_assoc($result)){
            echo'
            <div class="product">
     <div class="product_img">
       <img src="uploads/img//'.$row['proimg'].'">
       <span class="unavilibal">'.$row['prounv'].'</span>
       <a href=""></a>
     </div>
     <div class="product_section"><a href="">'.$row['prosection'].'</a></div>
     <div class="product_name"><a href="">'.$row['proname'].'</a></div>
     <div class="product_price"><a href="">'.$row['proprice'].' &nbsp;السعر </a></div>
     <div class="product_description"><a href="details.php"><i class="fa-solid fa-eye">'.$row['prodescript'].'</i> لتفاصي المنتج اضغط هنا</a></div>
      <div class="qty_input">
        <button class="qty_count_mins">-</button>
        <input class="t" type="number"  id="quantity" name="" value="1" min="0" max="7"/>
        <button class="qty_count_add" type="submit">+</button>
      </div><br />
     <div class="submit"><a href="">
     <button class="addto_Cart" type="submit" name=""><i class="fa-solid fa-cart-plus">&nbsp; &nbsp;</i>اضف الى السله</button>
     </a>
     </div>
   </div>
            ';
        }
     }else{
        echo
        '<div class="notification">المنتج غير متوفر في البحث</div>';
     }
}
?>
<?php
include('file/footer.php');
?>